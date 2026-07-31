import {
  KIND_GAME_ITEM_PLACEMENT,
  type KindGameItemPlacement,
} from "../../common/constants.js";
import {
  buildAddressableEventAddress,
  parseAddressableEventAddress,
  type AddressParseOptions,
} from "../../common/address.js";

export { KIND_GAME_ITEM_PLACEMENT, type KindGameItemPlacement };

/**
 * The marker used on an `a` tag to indicate a placed/equipped item reference.
 *
 * Only `a` tags carrying this marker are item references. An unmarked `a` tag,
 * or one with a different marker, is an unrelated relationship and MUST NOT be
 * interpreted as a placement.
 */
export const PLACEMENT_ITEM_MARKER = "item" as const;

/**
 * The marker used on an `a` tag to indicate the placement's target.
 */
export const PLACEMENT_TARGET_MARKER = "target" as const;

/**
 * The tag name used for an internal (non-addressable) target:
 * `["target", "<internal-target-id>"]`.
 */
export const PLACEMENT_TARGET_TAG = "target" as const;

export interface GameItemPlacementAddress {
  kind: KindGameItemPlacement;
  pubkey: string;
  /** The placement `d` tag / document identifier. */
  placementId: string;
}

/**
 * Build the addressable coordinate for a placement document:
 * `31634:<pubkey>:<placement-d-tag>`.
 *
 * The `d` value identifies the placement *document*. It is not the target: do
 * not assume it equals a character id, room id, map id or any other target id.
 */
export function buildGameItemPlacementAddress(
  pubkey: string,
  placementId: string,
): string {
  return buildAddressableEventAddress(
    KIND_GAME_ITEM_PLACEMENT,
    pubkey,
    placementId,
  );
}

/**
 * Parse a `31634:<pubkey>:<placement-d-tag>` coordinate.
 *
 * Returns `null` if the string is malformed or does not reference kind 31634.
 * Everything after the second colon is the `d` value, so identifiers that
 * themselves contain colons round-trip unchanged.
 */
export function parseGameItemPlacementAddress(
  address: string,
  options: AddressParseOptions = {},
): GameItemPlacementAddress | null {
  const parsed = parseAddressableEventAddress(address, options);
  if (parsed === null || parsed.kind !== KIND_GAME_ITEM_PLACEMENT) {
    return null;
  }
  return {
    kind: KIND_GAME_ITEM_PLACEMENT,
    pubkey: parsed.pubkey,
    placementId: parsed.identifier,
  };
}
