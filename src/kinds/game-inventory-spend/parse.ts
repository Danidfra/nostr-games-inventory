import type { NostrEvent } from "../../nostr/event.js";
import {
  type ParseMode,
  type ParseResult,
  type ParseWarning,
  ok,
  fail,
} from "../../common/result.js";
import { getTagValue } from "../../common/tags.js";
import { parseContentJson } from "../../common/json.js";
import { isBlank } from "../../common/strings.js";
import { KIND_GAME_INVENTORY_SPEND } from "../../common/constants.js";
import { parseInventoryQuantity } from "../game-inventory/quantity.js";
import { INVENTORY_MARKER } from "../game-inventory/address.js";
import { SPEND_ITEM_MARKER, SPEND_QUANTITY_TAG } from "./constants.js";
import { validateGameInventorySpend } from "./validate.js";
import type { GameInventorySpend } from "./types.js";

export interface ParseGameInventorySpendOptions {
  /**
   * `permissive` (default) tolerates invalid JSON content and blank optional
   * metadata tags, reporting them as warnings. `strict` rejects the event
   * when `content` is non-empty and not valid JSON.
   *
   * Neither mode relaxes a structural rule: an author mismatch, a malformed
   * address or a bad quantity rejects in both.
   */
  mode?: ParseMode;
  /** Require inventory / item pubkeys to be 64-char hex. Defaults to `false`. */
  requireHexPubkey?: boolean;
  /** Require `event.id` to be canonical 64-char hex. Defaults to `false`. */
  requireHexEventId?: boolean;
}

/**
 * Parse a kind:1416 event into a {@link GameInventorySpend}.
 *
 * The event is rejected (`ok: false`) when any structural rule fails — see
 * {@link validateGameInventorySpend}. In particular a spend whose author is not
 * the owner named in its inventory address is NOT a spend: it is rejected here
 * and can never affect a balance.
 *
 * Optional metadata is preserved but never validated beyond "non-blank":
 * `purpose`, `client`, `nonce` and `alt` are informational. A blank value is
 * ignored with an `invalid-metadata-tag` warning.
 */
export function parseGameInventorySpendResult(
  event: NostrEvent,
  options: ParseGameInventorySpendOptions = {},
): ParseResult<GameInventorySpend> {
  const mode: ParseMode = options.mode ?? "permissive";
  const warnings: ParseWarning[] = [];

  const validation = validateGameInventorySpend(event, {
    requireHexPubkey: options.requireHexPubkey ?? false,
    requireHexEventId: options.requireHexEventId ?? false,
  });
  if (!validation.valid) {
    return fail(validation.issues.map((i) => i.message).join("; "), warnings);
  }

  // Validation guarantees exactly one of each of these.
  const inventoryTag = event.tags.find(
    (tag) => tag[0] === "a" && tag[3] === INVENTORY_MARKER,
  ) as string[];
  const itemTag = event.tags.find(
    (tag) => tag[0] === "a" && tag[3] === SPEND_ITEM_MARKER,
  ) as string[];
  const quantity = parseInventoryQuantity(
    getTagValue(event.tags, SPEND_QUANTITY_TAG),
  ) as number;

  const contentParsed = parseContentJson(event.content);
  let contentJson: unknown;
  if (contentParsed.kind === "json") {
    contentJson = contentParsed.value;
  } else if (contentParsed.kind === "invalid") {
    if (mode === "strict") {
      return fail("`content` is not valid JSON", warnings);
    }
    warnings.push({
      code: "invalid-json-content",
      message: "`content` is not valid JSON; ignored",
    });
  }

  const spend: GameInventorySpend = {
    id: event.id as string,
    kind: KIND_GAME_INVENTORY_SPEND,
    owner: event.pubkey,
    createdAt: event.created_at,
    inventoryAddress: inventoryTag[1] as string,
    inventoryRelay: inventoryTag[2] ?? "",
    itemAddress: itemTag[1] as string,
    itemRelay: itemTag[2] ?? "",
    quantity,
    content: event.content,
    event,
  };

  const purpose = readMetadata(event.tags, "purpose", warnings);
  if (purpose !== undefined) {
    spend.purpose = purpose;
  }
  const client = readMetadata(event.tags, "client", warnings);
  if (client !== undefined) {
    spend.client = client;
  }
  const nonce = readMetadata(event.tags, "nonce", warnings);
  if (nonce !== undefined) {
    spend.nonce = nonce;
  }
  const alt = readMetadata(event.tags, "alt", warnings);
  if (alt !== undefined) {
    spend.alt = alt;
  }
  if (contentJson !== undefined) {
    spend.contentJson = contentJson;
  }

  return ok(spend, warnings);
}

/**
 * Convenience wrapper returning the parsed spend or `null`.
 */
export function parseGameInventorySpend(
  event: NostrEvent,
  options: ParseGameInventorySpendOptions = {},
): GameInventorySpend | null {
  const result = parseGameInventorySpendResult(event, options);
  return result.ok ? result.value : null;
}

/**
 * Read the first tag with `name`; a present-but-blank value is reported and
 * treated as absent. Metadata never decides validity, so this never rejects.
 */
function readMetadata(
  tags: string[][],
  name: string,
  warnings: ParseWarning[],
): string | undefined {
  for (const tag of tags) {
    if (tag[0] !== name) {
      continue;
    }
    const value = tag[1];
    if (typeof value !== "string" || isBlank(value)) {
      warnings.push({
        code: "invalid-metadata-tag",
        message: `\`${name}\` tag has a blank value; ignored`,
        tag,
      });
      return undefined;
    }
    return value;
  }
  return undefined;
}
