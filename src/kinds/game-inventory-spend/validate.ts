import type { NostrEvent } from "../../nostr/event.js";
import {
  KIND_GAME_INVENTORY_SPEND,
  KIND_GAME_INVENTORY,
  KIND_GAME_ITEM_DEFINITION,
} from "../../common/constants.js";
import { parseAddressableEventAddress } from "../../common/address.js";
import { isBlank, isHex64 } from "../../common/strings.js";
import { parseInventoryQuantity } from "../game-inventory/quantity.js";
import { INVENTORY_MARKER } from "../game-inventory/address.js";
import { SPEND_ITEM_MARKER, SPEND_QUANTITY_TAG } from "./constants.js";

export type SpendValidationIssueCode =
  | "wrong-kind"
  | "missing-event-id"
  | "invalid-event-id"
  | "missing-inventory-reference"
  | "duplicate-inventory-reference"
  | "malformed-inventory-address"
  | "wrong-inventory-kind"
  | "author-mismatch"
  | "missing-item-reference"
  | "duplicate-item-reference"
  | "malformed-item-address"
  | "wrong-item-kind"
  | "missing-quantity"
  | "duplicate-quantity"
  | "invalid-quantity";

export interface SpendValidationIssue {
  code: SpendValidationIssueCode;
  message: string;
}

export interface SpendValidationOptions {
  /** Require the inventory and item pubkeys to be 64-char lowercase hex. */
  requireHexPubkey?: boolean;
  /** Require `event.id` to be canonical 64-char lowercase hex. */
  requireHexEventId?: boolean;
}

export interface SpendValidationResult {
  valid: boolean;
  issues: SpendValidationIssue[];
}

/**
 * Validate the structural (MUST-reject) rules of a kind:1416 spend.
 *
 * Every rule here is a rejection: a spend is either a valid spend event or it
 * is nothing, because a partially valid debit cannot be safely accounted.
 *
 * - `kind` MUST be 1416.
 * - `id` MUST be present: the event id is the spend's identity.
 * - Exactly one `a` tag marked `inventory` MUST reference a well-formed
 *   `31633:<owner>:<d>` address, and `event.pubkey` MUST equal `<owner>`.
 * - Exactly one `a` tag marked `item` MUST reference a well-formed
 *   `31632:<issuer>:<d>` address.
 * - Exactly one `quantity` tag MUST carry a canonical positive integer.
 *
 * Optional metadata (`purpose`, `client`, `nonce`, `alt`, `content`) is never
 * consulted: it MUST NOT affect whether a spend is valid.
 */
export function validateGameInventorySpend(
  event: NostrEvent,
  options: SpendValidationOptions = {},
): SpendValidationResult {
  const issues: SpendValidationIssue[] = [];
  const requireHexPubkey = options.requireHexPubkey ?? false;

  if (event.kind !== KIND_GAME_INVENTORY_SPEND) {
    issues.push({
      code: "wrong-kind",
      message: `Expected kind ${KIND_GAME_INVENTORY_SPEND}, got ${event.kind}`,
    });
  }

  if (typeof event.id !== "string" || isBlank(event.id)) {
    issues.push({
      code: "missing-event-id",
      message: "Missing event id; a spend's identity is its event id",
    });
  } else if (options.requireHexEventId && !isHex64(event.id)) {
    issues.push({
      code: "invalid-event-id",
      message: `Event id is not canonical 64-char hex: ${event.id}`,
    });
  }

  // Inventory reference: exactly one `a` tag marked `inventory`.
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
      message: `More than one \`a\` tag marked \`${INVENTORY_MARKER}\`; a spend debits exactly one inventory`,
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
        message: `Spend author ${event.pubkey} is not the inventory owner ${parsed.pubkey}`,
      });
    }
  }

  // Item reference: exactly one `a` tag marked `item`.
  const itemTags = event.tags.filter(
    (tag) => tag[0] === "a" && tag[3] === SPEND_ITEM_MARKER,
  );
  if (itemTags.length === 0) {
    issues.push({
      code: "missing-item-reference",
      message: `Missing \`a\` tag marked \`${SPEND_ITEM_MARKER}\``,
    });
  } else if (itemTags.length > 1) {
    issues.push({
      code: "duplicate-item-reference",
      message: `More than one \`a\` tag marked \`${SPEND_ITEM_MARKER}\`; a spend debits exactly one item`,
    });
  } else {
    const address = itemTags[0]?.[1];
    const parsed =
      typeof address === "string"
        ? parseAddressableEventAddress(address, { requireHexPubkey })
        : null;
    if (parsed === null) {
      issues.push({
        code: "malformed-item-address",
        message: `Malformed item address: ${String(address)}`,
      });
    } else if (parsed.kind !== KIND_GAME_ITEM_DEFINITION) {
      issues.push({
        code: "wrong-item-kind",
        message: `Item reference does not reference kind ${KIND_GAME_ITEM_DEFINITION}: ${String(address)}`,
      });
    }
  }

  // Quantity: exactly one `quantity` tag with a canonical positive integer.
  const quantityTags = event.tags.filter(
    (tag) => tag[0] === SPEND_QUANTITY_TAG,
  );
  if (quantityTags.length === 0) {
    issues.push({
      code: "missing-quantity",
      message: `Missing \`${SPEND_QUANTITY_TAG}\` tag`,
    });
  } else if (quantityTags.length > 1) {
    issues.push({
      code: "duplicate-quantity",
      message: `More than one \`${SPEND_QUANTITY_TAG}\` tag`,
    });
  } else if (parseInventoryQuantity(quantityTags[0]?.[1]) === null) {
    issues.push({
      code: "invalid-quantity",
      message: `Invalid quantity (must be a canonical positive integer): ${String(quantityTags[0]?.[1])}`,
    });
  }

  return { valid: issues.length === 0, issues };
}
