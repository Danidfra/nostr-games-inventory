import {
  KIND_GAME_ITEM_DEFINITION,
  type KindGameItemDefinition,
} from "../../common/constants.js";
import {
  buildAddressableEventAddress,
  parseAddressableEventAddress,
  type AddressParseOptions,
} from "../../common/address.js";

export { KIND_GAME_ITEM_DEFINITION, type KindGameItemDefinition };

/**
 * The marker used on an `a` tag to indicate a derivation reference.
 */
export const BASED_ON_MARKER = "based_on" as const;

export interface GameItemAddress {
  kind: KindGameItemDefinition;
  pubkey: string;
  /** The item `d` tag / identifier. */
  itemId: string;
}

/**
 * Build the addressable coordinate for a game item definition:
 * `31632:<pubkey>:<item-d-tag>`.
 */
export function buildGameItemAddress(pubkey: string, itemId: string): string {
  return buildAddressableEventAddress(
    KIND_GAME_ITEM_DEFINITION,
    pubkey,
    itemId,
  );
}

/**
 * Parse a `31632:<pubkey>:<item-d-tag>` coordinate.
 *
 * Returns `null` if the string is malformed or does not reference kind 31632.
 */
export function parseGameItemAddress(
  address: string,
  options: AddressParseOptions = {},
): GameItemAddress | null {
  const parsed = parseAddressableEventAddress(address, options);
  if (parsed === null || parsed.kind !== KIND_GAME_ITEM_DEFINITION) {
    return null;
  }
  return {
    kind: KIND_GAME_ITEM_DEFINITION,
    pubkey: parsed.pubkey,
    itemId: parsed.identifier,
  };
}
