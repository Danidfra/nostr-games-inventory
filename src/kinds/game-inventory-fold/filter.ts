import {
  KIND_GAME_INVENTORY_FOLD,
  type KindGameInventoryFold,
} from "../../common/constants.js";
import { uniqueNonBlank } from "../../common/strings.js";

/**
 * A plain Nostr filter object for kind:1417 fold manifest events.
 */
export interface GameInventoryFoldFilter {
  kinds: [KindGameInventoryFold];
  ids?: string[];
  authors?: string[];
  "#a"?: string[];
}

export interface BuildGameInventoryFoldFilterOptions {
  /** Fetch these specific manifest ids (the head and its `previous` links). */
  ids?: string[];
  /** Restrict to these authors (normally the inventory owner). */
  authors?: string[];
  /** Restrict to manifests scoped to these `31633:<owner>:<d>` inventories. */
  inventoryAddresses?: string[];
}

/**
 * Build a generic Nostr filter for kind:1417 events.
 *
 * Two shapes are useful. Resolving a snapshot's chain by id:
 *
 * ```ts
 * buildGameInventoryFoldFilter({ ids: [inventory.fold.eventId] });
 * ```
 *
 * and fetching every manifest an owner has ever written for one inventory,
 * which normally covers the whole chain in one round trip:
 *
 * ```ts
 * buildGameInventoryFoldFilter({
 *   authors: [owner],
 *   inventoryAddresses: [inventory.address],
 * });
 * ```
 *
 * Blank values are omitted and duplicates are removed; an option that resolves
 * to no values is left out of the filter entirely. Output is deterministic.
 */
export function buildGameInventoryFoldFilter(
  options: BuildGameInventoryFoldFilterOptions = {},
): GameInventoryFoldFilter {
  const filter: GameInventoryFoldFilter = {
    kinds: [KIND_GAME_INVENTORY_FOLD],
  };

  const ids = uniqueNonBlank(options.ids);
  if (ids.length > 0) {
    filter.ids = ids;
  }
  const authors = uniqueNonBlank(options.authors);
  if (authors.length > 0) {
    filter.authors = authors;
  }
  const addresses = uniqueNonBlank(options.inventoryAddresses);
  if (addresses.length > 0) {
    filter["#a"] = addresses;
  }

  return filter;
}
