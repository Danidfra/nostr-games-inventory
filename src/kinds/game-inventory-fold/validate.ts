import type { NostrEvent } from "../../nostr/event.js";
import {
  KIND_GAME_INVENTORY_FOLD,
  KIND_GAME_INVENTORY,
} from "../../common/constants.js";
import { parseAddressableEventAddress } from "../../common/address.js";
import { isBlank, isHex64 } from "../../common/strings.js";
import { INVENTORY_MARKER } from "../game-inventory/address.js";
import {
  FOLD_PREVIOUS_MARKER,
  FOLD_SPEND_MARKER,
  FOLD_VOID_MARKER,
} from "./constants.js";

export type FoldValidationIssueCode =
  | "wrong-kind"
  | "missing-event-id"
  | "invalid-event-id"
  | "missing-inventory-reference"
  | "duplicate-inventory-reference"
  | "malformed-inventory-address"
  | "wrong-inventory-kind"
  | "author-mismatch"
  | "duplicate-previous-reference"
  | "invalid-previous-reference"
  | "self-reference"
  | "no-spend-references"
  | "invalid-spend-reference"
  | "duplicate-spend-reference"
  | "previous-is-spend";

export interface FoldValidationIssue {
  code: FoldValidationIssueCode;
  message: string;
}

export interface FoldValidationOptions {
  /** Require the inventory pubkey to be 64-char lowercase hex. */
  requireHexPubkey?: boolean;
  /** Require `event.id` and every referenced id to be 64-char lowercase hex. */
  requireHexEventId?: boolean;
}

export interface FoldValidationResult {
  valid: boolean;
  issues: FoldValidationIssue[];
}

/**
 * Validate the structural (MUST-reject) rules of a kind:1417 fold manifest.
 *
 * - `kind` MUST be 1417 and `id` MUST be present.
 * - Exactly one `a` tag marked `inventory` MUST reference a well-formed
 *   `31633:<owner>:<d>` address, and `event.pubkey` MUST equal `<owner>`.
 * - At most one `e` tag marked `previous`, with a non-blank id that is not
 *   the manifest's own id.
 * - At least one `e` tag marked `spend` or `void`, each with a non-blank id.
 * - No id may appear twice across `spend` / `void` references, and the
 *   `previous` id may not also be a spend or void reference.
 *
 * Duplicates are rejections, not deduplications: a manifest that lists the
 * same spend twice, or both folds and voids it, is ambiguous about what the
 * snapshot incorporated, and ambiguity here changes balances.
 *
 * Whether the referenced spends exist, are valid, are applicable, or were
 * already settled by an earlier manifest cannot be known from the event
 * alone; that is chain verification, see `resolveGameInventoryFoldChain`.
 */
export function validateGameInventoryFold(
  event: NostrEvent,
  options: FoldValidationOptions = {},
): FoldValidationResult {
  const issues: FoldValidationIssue[] = [];
  const requireHexPubkey = options.requireHexPubkey ?? false;
  const requireHexEventId = options.requireHexEventId ?? false;

  if (event.kind !== KIND_GAME_INVENTORY_FOLD) {
    issues.push({
      code: "wrong-kind",
      message: `Expected kind ${KIND_GAME_INVENTORY_FOLD}, got ${event.kind}`,
    });
  }

  if (typeof event.id !== "string" || isBlank(event.id)) {
    issues.push({
      code: "missing-event-id",
      message:
        "Missing event id; a fold manifest is referenced by its event id",
    });
  } else if (requireHexEventId && !isHex64(event.id)) {
    issues.push({
      code: "invalid-event-id",
      message: `Event id is not canonical 64-char hex: ${event.id}`,
    });
  }

  const inventoryTags = event.tags.filter(
    (tag) => tag[0] === "a" && tag[3] === INVENTORY_MARKER,
  );
  if (inventoryTags.length === 0) {
    issues.push({
      code: "missing-inventory-reference",
      message: `Missing \`a\` tag marked \`${INVENTORY_MARKER}\``,
    });
  } else if (inventoryTags.length > 1) {
    issues.push({
      code: "duplicate-inventory-reference",
      message: `More than one \`a\` tag marked \`${INVENTORY_MARKER}\`; a manifest is scoped to exactly one inventory`,
    });
  } else {
    const address = inventoryTags[0]?.[1];
    const parsed =
      typeof address === "string"
        ? parseAddressableEventAddress(address, { requireHexPubkey })
        : null;
    if (parsed === null) {
      issues.push({
        code: "malformed-inventory-address",
        message: `Malformed inventory address: ${String(address)}`,
      });
    } else if (parsed.kind !== KIND_GAME_INVENTORY) {
      issues.push({
        code: "wrong-inventory-kind",
        message: `Inventory reference does not reference kind ${KIND_GAME_INVENTORY}: ${String(address)}`,
      });
    } else if (parsed.pubkey !== event.pubkey) {
      issues.push({
        code: "author-mismatch",
        message: `Manifest author ${event.pubkey} is not the inventory owner ${parsed.pubkey}`,
      });
    }
  }

  const previousTags = event.tags.filter(
    (tag) => tag[0] === "e" && tag[3] === FOLD_PREVIOUS_MARKER,
  );
  let previousId: string | undefined;
  if (previousTags.length > 1) {
    issues.push({
      code: "duplicate-previous-reference",
      message: `More than one \`e\` tag marked \`${FOLD_PREVIOUS_MARKER}\`; a manifest has at most one predecessor`,
    });
  } else if (previousTags.length === 1) {
    const id = previousTags[0]?.[1];
    if (typeof id !== "string" || isBlank(id)) {
      issues.push({
        code: "invalid-previous-reference",
        message: "`previous` reference is missing an event id",
      });
    } else if (requireHexEventId && !isHex64(id)) {
      issues.push({
        code: "invalid-previous-reference",
        message: `\`previous\` event id is not canonical 64-char hex: ${id}`,
      });
    } else {
      previousId = id;
      if (id === event.id) {
        issues.push({
          code: "self-reference",
          message: "`previous` references the manifest itself",
        });
      }
    }
  }

  const seen = new Set<string>();
  let references = 0;
  for (const tag of event.tags) {
    if (
      tag[0] !== "e" ||
      (tag[3] !== FOLD_SPEND_MARKER && tag[3] !== FOLD_VOID_MARKER)
    ) {
      continue;
    }
    references += 1;
    const id = tag[1];
    if (typeof id !== "string" || isBlank(id)) {
      issues.push({
        code: "invalid-spend-reference",
        message: `\`${tag[3]}\` reference is missing an event id`,
      });
      continue;
    }
    if (requireHexEventId && !isHex64(id)) {
      issues.push({
        code: "invalid-spend-reference",
        message: `\`${tag[3]}\` event id is not canonical 64-char hex: ${id}`,
      });
      continue;
    }
    if (seen.has(id)) {
      issues.push({
        code: "duplicate-spend-reference",
        message: `Spend ${id} is referenced more than once in the same manifest`,
      });
      continue;
    }
    seen.add(id);
    if (id === previousId) {
      issues.push({
        code: "previous-is-spend",
        message: `\`previous\` id ${id} is also referenced as a spend`,
      });
    }
    if (id === event.id) {
      issues.push({
        code: "self-reference",
        message: "A spend reference names the manifest itself",
      });
    }
  }
  if (references === 0) {
    issues.push({
      code: "no-spend-references",
      message: `A manifest MUST reference at least one \`${FOLD_SPEND_MARKER}\` or \`${FOLD_VOID_MARKER}\` spend`,
    });
  }

  return { valid: issues.length === 0, issues };
}
