import type { NostrEvent } from "../../nostr/event.js";
import {
  type ParseMode,
  type ParseResult,
  type ParseWarning,
  ok,
  fail,
} from "../../common/result.js";
import { getTagValue, getTagValues } from "../../common/tags.js";
import { parseContentJson } from "../../common/json.js";
import { isBlank } from "../../common/strings.js";
import { KIND_GAME_INVENTORY } from "../../common/constants.js";
import {
  parseGameItemAddress,
  KIND_GAME_ITEM_DEFINITION,
} from "../game-item-definition/address.js";
import { parseAddressableEventAddress } from "../../common/address.js";
import { parseInventoryQuantity } from "./quantity.js";
import { MAX_QUANTITY } from "./quantity.internal.js";
import { validateGameInventory } from "./validate.js";
import { GRANT_MARKER, buildGameInventoryAddress } from "./address.js";
import type {
  GameInventory,
  GameInventoryItem,
  GameInventoryGrantReference,
  DuplicateStrategy,
} from "./types.js";

const HEX64 = /^[0-9a-f]{64}$/;

export interface ParseGameInventoryOptions {
  /**
   * `permissive` (default) tolerates invalid JSON content and ignores invalid
   * item tags. `strict` additionally:
   * - rejects the event when `content` is non-empty and not valid JSON;
   * - defaults the duplicate strategy to `strict` (reject on duplicates).
   */
  mode?: ParseMode;
  /**
   * Duplicate item address handling. When omitted, defaults to `strict` in
   * strict mode and `last` in permissive mode (the spec's recommended
   * default).
   */
  duplicateStrategy?: DuplicateStrategy;
  /**
   * Require valid JSON content independent of mode. Defaults to `true` in
   * strict mode, `false` in permissive mode.
   */
  requireJsonContent?: boolean;
  /**
   * Require item addresses to use 64-char hex pubkeys. Defaults to `false`
   * (the spec examples use placeholder pubkeys).
   */
  requireHexPubkey?: boolean;
  /**
   * Require grant `e` tag event ids to be canonical 64-char lowercase hex.
   * Defaults to `false` so fixture placeholders remain supported.
   */
  requireHexEventId?: boolean;
}

/**
 * Parse a kind:31633 event into a {@link GameInventory}, returning a structured
 * {@link ParseResult}.
 *
 * The event is rejected (`ok: false`) only when: kind is wrong, `d` is
 * missing/empty, JSON content is required but invalid, duplicate item
 * references are present under the `strict` strategy, or a `sum` duplicate
 * resolution would overflow Number.MAX_SAFE_INTEGER. Item references that are
 * malformed, reference a non-31632 kind, or carry an invalid quantity are
 * ignored and reported as warnings. Malformed grant tags are ignored with an
 * `invalid-grant-tag` warning.
 */
export function parseGameInventoryResult(
  event: NostrEvent,
  options: ParseGameInventoryOptions = {},
): ParseResult<GameInventory> {
  const mode: ParseMode = options.mode ?? "permissive";
  const requireJsonContent = options.requireJsonContent ?? mode === "strict";
  const duplicateStrategy: DuplicateStrategy =
    options.duplicateStrategy ?? (mode === "strict" ? "strict" : "last");
  const requireHexPubkey = options.requireHexPubkey ?? false;
  const requireHexEventId = options.requireHexEventId ?? false;
  const warnings: ParseWarning[] = [];

  const validation = validateGameInventory(event, { requireJsonContent });
  if (!validation.valid) {
    return fail(validation.issues.map((i) => i.message).join("; "), warnings);
  }

  const id = getTagValue(event.tags, "d") as string;

  // Collect valid item references in tag order.
  const collected: GameInventoryItem[] = [];
  for (const tag of event.tags) {
    if (tag[0] !== "a") {
      continue;
    }
    const address = tag[1];
    if (typeof address !== "string") {
      warnings.push({
        code: "invalid-item-tag",
        message: "`a` tag missing address",
        tag,
      });
      continue;
    }

    // Distinguish malformed vs. wrong-kind by first parsing with the generic
    // addressable-event parser (not by string prefix).
    const generic = parseAddressableEventAddress(address, { requireHexPubkey });
    if (generic === null) {
      warnings.push({
        code: "malformed-address",
        message: `Malformed item address: ${address}`,
        tag,
      });
      continue;
    }
    if (generic.kind !== KIND_GAME_ITEM_DEFINITION) {
      warnings.push({
        code: "wrong-referenced-kind",
        message: `Item \`a\` tag does not reference kind ${KIND_GAME_ITEM_DEFINITION}: ${address}`,
        tag,
      });
      continue;
    }
    // Confirm with the kind-specific parser (honours requireHexPubkey too).
    if (parseGameItemAddress(address, { requireHexPubkey }) === null) {
      warnings.push({
        code: "malformed-address",
        message: `Malformed item address: ${address}`,
        tag,
      });
      continue;
    }

    const quantity = parseInventoryQuantity(tag[3]);
    if (quantity === null) {
      warnings.push({
        code: "invalid-quantity",
        message: `Invalid or missing quantity for ${address}: ${String(tag[3])}`,
        tag,
      });
      continue;
    }

    collected.push({ address, relay: tag[2] ?? "", quantity });
  }

  const resolved = resolveDuplicates(collected, duplicateStrategy, warnings);
  if (!resolved.ok) {
    return fail(resolved.error, warnings);
  }

  const grants = parseGrants(event.tags, requireHexEventId, warnings);

  const contentParsed = parseContentJson(event.content);
  let contentJson: unknown;
  if (contentParsed.kind === "json") {
    contentJson = contentParsed.value;
  } else if (contentParsed.kind === "invalid") {
    warnings.push({
      code: "invalid-json-content",
      message: "`content` is not valid JSON; ignored",
    });
  }

  const inventory: GameInventory = {
    id,
    address: buildGameInventoryAddress(event.pubkey, id),
    owner: event.pubkey,
    kind: KIND_GAME_INVENTORY,
    contexts: getTagValues(event.tags, "context"),
    items: resolved.value,
    grants,
    grantEventIds: grants.map((g) => g.eventId),
    content: event.content,
    event,
  };

  const name = getTagValue(event.tags, "name");
  if (name !== undefined) {
    inventory.name = name;
  }
  const alt = getTagValue(event.tags, "alt");
  if (alt !== undefined) {
    inventory.alt = alt;
  }
  if (contentJson !== undefined) {
    inventory.contentJson = contentJson;
  }

  return ok(inventory, warnings);
}

/**
 * Convenience wrapper returning the parsed inventory or `null`.
 */
export function parseGameInventory(
  event: NostrEvent,
  options: ParseGameInventoryOptions = {},
): GameInventory | null {
  const result = parseGameInventoryResult(event, options);
  return result.ok ? result.value : null;
}

type DuplicateResolution =
  { ok: true; value: GameInventoryItem[] } | { ok: false; error: string };

function resolveDuplicates(
  items: GameInventoryItem[],
  strategy: DuplicateStrategy,
  warnings: ParseWarning[],
): DuplicateResolution {
  // Identify which addresses actually occur more than once.
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item.address, (counts.get(item.address) ?? 0) + 1);
  }
  const hasDuplicate = [...counts.values()].some((n) => n > 1);

  if (!hasDuplicate) {
    return { ok: true, value: items.map((item) => ({ ...item })) };
  }

  if (strategy === "strict") {
    return {
      ok: false,
      error:
        "Duplicate item references present and duplicate strategy is `strict`",
    };
  }

  // Warn once per duplicated address (not once per item).
  for (const [address, count] of counts) {
    if (count > 1) {
      warnings.push({
        code: "duplicate-item",
        message: `Duplicate item reference (${count}x) resolved with strategy \`${strategy}\`: ${address}`,
      });
    }
  }

  // Preserve first-seen order; `last` overwrites quantity, `sum` accumulates.
  const order: string[] = [];
  const byAddress = new Map<string, GameInventoryItem>();
  for (const item of items) {
    const existing = byAddress.get(item.address);
    if (existing === undefined) {
      order.push(item.address);
      byAddress.set(item.address, { ...item });
    } else if (strategy === "sum") {
      const sum = existing.quantity + item.quantity;
      if (sum > MAX_QUANTITY || !Number.isSafeInteger(sum)) {
        return {
          ok: false,
          error: `Summed quantity for ${item.address} exceeds Number.MAX_SAFE_INTEGER`,
        };
      }
      existing.quantity = sum;
      existing.relay = item.relay;
    } else {
      // last
      existing.quantity = item.quantity;
      existing.relay = item.relay;
    }
  }

  return {
    ok: true,
    value: order.map((addr) => byAddress.get(addr) as GameInventoryItem),
  };
}

function parseGrants(
  tags: string[][],
  requireHexEventId: boolean,
  warnings: ParseWarning[],
): GameInventoryGrantReference[] {
  const grants: GameInventoryGrantReference[] = [];
  for (const tag of tags) {
    if (tag[0] !== "e") {
      continue;
    }
    if (tag[3] !== GRANT_MARKER) {
      // Not a grant reference; leave for other consumers.
      continue;
    }
    const eventId = tag[1];
    if (typeof eventId !== "string" || isBlank(eventId)) {
      warnings.push({
        code: "invalid-grant-tag",
        message: "Grant `e` tag is missing an event id; ignored",
        tag,
      });
      continue;
    }
    if (requireHexEventId && !HEX64.test(eventId)) {
      warnings.push({
        code: "invalid-grant-tag",
        message: `Grant \`e\` tag event id is not canonical 64-char hex; ignored: ${eventId}`,
        tag,
      });
      continue;
    }
    grants.push({ eventId, relay: tag[2] ?? "" });
  }
  return grants;
}
