import type { NostrEvent } from "../../nostr/event.js";
import {
  type ParseMode,
  type ParseResult,
  type ParseWarning,
  ok,
  fail,
} from "../../common/result.js";
import { parseContentJson } from "../../common/json.js";
import { isBlank } from "../../common/strings.js";
import { KIND_GAME_INVENTORY_FOLD } from "../../common/constants.js";
import { INVENTORY_MARKER } from "../game-inventory/address.js";
import {
  FOLD_PREVIOUS_MARKER,
  FOLD_SPEND_MARKER,
  FOLD_VOID_MARKER,
} from "./constants.js";
import { validateGameInventoryFold } from "./validate.js";
import type {
  GameInventoryEventReference,
  GameInventoryFold,
} from "./types.js";

export interface ParseGameInventoryFoldOptions {
  /**
   * `permissive` (default) tolerates invalid JSON content with a warning.
   * `strict` rejects the event when `content` is non-empty and not valid
   * JSON. Neither mode relaxes a structural rule.
   */
  mode?: ParseMode;
  /** Require the inventory pubkey to be 64-char hex. Defaults to `false`. */
  requireHexPubkey?: boolean;
  /** Require every event id to be canonical 64-char hex. Defaults to `false`. */
  requireHexEventId?: boolean;
}

/**
 * Parse a kind:1417 event into a {@link GameInventoryFold}.
 *
 * This is a STRUCTURAL parse: it establishes that the event is a well-formed
 * manifest authored by the inventory owner and lists what it references. It
 * cannot know whether those references exist, are valid spends, were
 * applicable, or were already settled by an earlier manifest. Use
 * `resolveGameInventoryFoldChain` with the fetched events for that.
 */
export function parseGameInventoryFoldResult(
  event: NostrEvent,
  options: ParseGameInventoryFoldOptions = {},
): ParseResult<GameInventoryFold> {
  const mode: ParseMode = options.mode ?? "permissive";
  const warnings: ParseWarning[] = [];

  const validation = validateGameInventoryFold(event, {
    requireHexPubkey: options.requireHexPubkey ?? false,
    requireHexEventId: options.requireHexEventId ?? false,
  });
  if (!validation.valid) {
    return fail(validation.issues.map((i) => i.message).join("; "), warnings);
  }

  const inventoryTag = event.tags.find(
    (tag) => tag[0] === "a" && tag[3] === INVENTORY_MARKER,
  ) as string[];

  let previous: GameInventoryEventReference | undefined;
  const spends: GameInventoryEventReference[] = [];
  const voids: GameInventoryEventReference[] = [];
  for (const tag of event.tags) {
    if (tag[0] !== "e") {
      continue;
    }
    const reference = { eventId: tag[1] as string, relay: tag[2] ?? "" };
    if (tag[3] === FOLD_PREVIOUS_MARKER) {
      previous = reference;
    } else if (tag[3] === FOLD_SPEND_MARKER) {
      spends.push(reference);
    } else if (tag[3] === FOLD_VOID_MARKER) {
      voids.push(reference);
    }
  }

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

  const fold: GameInventoryFold = {
    id: event.id as string,
    kind: KIND_GAME_INVENTORY_FOLD,
    owner: event.pubkey,
    createdAt: event.created_at,
    inventoryAddress: inventoryTag[1] as string,
    inventoryRelay: inventoryTag[2] ?? "",
    spends,
    voids,
    spendIds: spends.map((s) => s.eventId),
    voidIds: voids.map((v) => v.eventId),
    content: event.content,
    event,
  };
  if (previous !== undefined) {
    fold.previous = previous;
  }
  const altTag = event.tags.find((tag) => tag[0] === "alt");
  if (altTag !== undefined) {
    const alt = altTag[1];
    if (typeof alt === "string" && !isBlank(alt)) {
      fold.alt = alt;
    } else {
      warnings.push({
        code: "invalid-metadata-tag",
        message: "`alt` tag has a blank value; ignored",
        tag: altTag,
      });
    }
  }
  if (contentJson !== undefined) {
    fold.contentJson = contentJson;
  }

  return ok(fold, warnings);
}

/**
 * Convenience wrapper returning the parsed manifest or `null`.
 */
export function parseGameInventoryFold(
  event: NostrEvent,
  options: ParseGameInventoryFoldOptions = {},
): GameInventoryFold | null {
  const result = parseGameInventoryFoldResult(event, options);
  return result.ok ? result.value : null;
}
