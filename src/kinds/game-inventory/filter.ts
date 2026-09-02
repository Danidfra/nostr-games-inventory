import {
  KIND_GAME_INVENTORY,
  type KindGameInventory,
} from "../../common/constants.js";
import { uniqueNonBlank } from "../../common/strings.js";

/**
 * A plain Nostr filter object for inventory events.
 *
 * Deliberately structural: this library has no relay or SDK dependency, so the
 * filter is a value you hand to whatever client you already use.
 */
export interface GameInventoryFilter {
  kinds: [KindGameInventory];
  authors?: string[];
  "#d"?: string[];
  "#a"?: string[];
}

export interface BuildGameInventoryFilterOptions {
  /** Restrict to these inventory owners. */
  authors?: string[];
  /** Restrict to these inventory `d` values (inventory contexts). */
  inventoryIds?: string[];
  /** Restrict to inventories referencing these kind:31632 item addresses. */
  addresses?: string[];
}

/**
 * Build a generic Nostr filter for kind:31633 events.
 *
 * ## Discovering every inventory a player owns
 *
 * Passing only `authors` is the whole discovery story for this kind:
 *
 * ```ts
 * buildGameInventoryFilter({ authors: [pubkey] });
 * // { kinds: [31633], authors: [pubkey] }
 * ```
 *
 * Addressable events are indexed by author and kind, so this returns the newest
 * event for EVERY `d` that player has ever written — a game inventory, a
 * backpack, a chest, a character's bag — without the caller knowing any `d`
 * value in advance. A client that has only a pubkey can enumerate everything
 * the player owns, then resolve the referenced kind:31632 definitions.
 *
 * Omit `inventoryIds` unless you specifically want one known context. Pinning a
 * single `#d` is a write-side convention leaking into the read side: it makes a
 * client structurally unable to see any inventory but its own.
 *
 * Blank values are omitted and duplicates are removed; an option that resolves
 * to no values is left out of the filter entirely rather than emitted as an
 * empty array, which most relays treat as "match nothing". Output is
 * deterministic: identical input produces an identical filter.
 */
export function buildGameInventoryFilter(
  options: BuildGameInventoryFilterOptions = {},
): GameInventoryFilter {
  const filter: GameInventoryFilter = { kinds: [KIND_GAME_INVENTORY] };

  const authors = uniqueNonBlank(options.authors);
  if (authors.length > 0) {
    filter.authors = authors;
  }
  const inventoryIds = uniqueNonBlank(options.inventoryIds);
  if (inventoryIds.length > 0) {
    filter["#d"] = inventoryIds;
  }
  const addresses = uniqueNonBlank(options.addresses);
  if (addresses.length > 0) {
    filter["#a"] = addresses;
  }

  return filter;
}
