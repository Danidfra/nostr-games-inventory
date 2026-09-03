import {
  KIND_GAME_INVENTORY_SPEND,
  type KindGameInventorySpend,
} from "../../common/constants.js";
import { uniqueNonBlank } from "../../common/strings.js";

/**
 * A plain Nostr filter object for kind:1416 spend events.
 */
export interface GameInventorySpendFilter {
  kinds: [KindGameInventorySpend];
  ids?: string[];
  authors?: string[];
  "#a"?: string[];
}

export interface BuildGameInventorySpendFilterOptions {
  /** Fetch these specific spend event ids (for example to reconcile a retry). */
  ids?: string[];
  /**
   * Restrict to these authors. A valid spend is always authored by its
   * inventory owner, so this is normally the owner pubkey of the inventories
   * in `inventoryAddresses`.
   */
  authors?: string[];
  /** Restrict to spends against these `31633:<owner>:<d>` inventories. */
  inventoryAddresses?: string[];
  /** Restrict to spends of these `31632:<issuer>:<d>` items. */
  itemAddresses?: string[];
}

/**
 * Build a generic Nostr filter for kind:1416 events.
 *
 * The usual query — every outstanding spend against one inventory — is:
 *
 * ```ts
 * buildGameInventorySpendFilter({
 *   authors: [owner],
 *   inventoryAddresses: [inventoryAddress],
 * });
 * ```
 *
 * Both the inventory and the item are `a` tags, so `inventoryAddresses` and
 * `itemAddresses` are merged into one `#a` list, which relays match as a
 * UNION: an event matches if any of its `a` tags is in the list. Passing both
 * therefore widens the result to "spends against these inventories OR of
 * these items"; it does not intersect. Narrow locally — the derivation
 * already ignores spends against other inventories.
 *
 * There is deliberately no `since` option. Spends are settled by explicit id
 * through the fold chain, never by timestamp; a `since` cut-off would hide a
 * late-arriving older spend that is still pending.
 *
 * Blank values are omitted and duplicates are removed; an option that resolves
 * to no values is left out of the filter entirely rather than emitted as an
 * empty array. Output is deterministic.
 */
export function buildGameInventorySpendFilter(
  options: BuildGameInventorySpendFilterOptions = {},
): GameInventorySpendFilter {
  const filter: GameInventorySpendFilter = {
    kinds: [KIND_GAME_INVENTORY_SPEND],
  };

  const ids = uniqueNonBlank(options.ids);
  if (ids.length > 0) {
    filter.ids = ids;
  }
  const authors = uniqueNonBlank(options.authors);
  if (authors.length > 0) {
    filter.authors = authors;
  }
  const addresses = uniqueNonBlank([
    ...(options.inventoryAddresses ?? []),
    ...(options.itemAddresses ?? []),
  ]);
  if (addresses.length > 0) {
    filter["#a"] = addresses;
  }

  return filter;
}
