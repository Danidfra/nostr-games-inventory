import {
  KIND_GAME_INVENTORY,
  type KindGameInventory,
} from "../../common/constants.js";
import {
  buildAddressableEventAddress,
  parseAddressableEventAddress,
  type AddressParseOptions,
} from "../../common/address.js";

export { KIND_GAME_INVENTORY, type KindGameInventory };

/**
 * The marker used on an `e` tag to indicate a grant / receipt reference.
 */
export const GRANT_MARKER = "grant" as const;

/**
 * The marker used on an `e` tag to reference the kind:1417 fold manifest whose
 * spends this snapshot has incorporated:
 * `["e", "<fold-manifest-id>", "<relay-url>", "fold"]`.
 *
 * At most one fold reference is valid per inventory event.
 */
export const INVENTORY_FOLD_MARKER = "fold" as const;

/**
 * The marker used on an `a` tag, in kind:1416 and kind:1417 events, to
 * reference the `31633:<owner>:<d>` inventory the event applies to:
 * `["a", "31633:<owner-pubkey>:<inventory-d-tag>", "<relay-url>", "inventory"]`.
 */
export const INVENTORY_MARKER = "inventory" as const;

export interface GameInventoryAddress {
  kind: KindGameInventory;
  pubkey: string;
  /** The inventory `d` tag / context identifier. */
  inventoryId: string;
}

/**
 * Build the addressable coordinate for a game inventory:
 * `31633:<owner-pubkey>:<inventory-d-tag>`.
 */
export function buildGameInventoryAddress(
  ownerPubkey: string,
  inventoryId: string,
): string {
  return buildAddressableEventAddress(
    KIND_GAME_INVENTORY,
    ownerPubkey,
    inventoryId,
  );
}

/**
 * Parse a `31633:<owner-pubkey>:<inventory-d-tag>` coordinate.
 *
 * Returns `null` if the string is malformed or does not reference kind 31633.
 */
export function parseGameInventoryAddress(
  address: string,
  options: AddressParseOptions = {},
): GameInventoryAddress | null {
  const parsed = parseAddressableEventAddress(address, options);
  if (parsed === null || parsed.kind !== KIND_GAME_INVENTORY) {
    return null;
  }
  return {
    kind: KIND_GAME_INVENTORY,
    pubkey: parsed.pubkey,
    inventoryId: parsed.identifier,
  };
}
