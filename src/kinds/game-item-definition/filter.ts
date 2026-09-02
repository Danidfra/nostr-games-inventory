import {
  KIND_GAME_ITEM_DEFINITION,
  type KindGameItemDefinition,
} from "../../common/constants.js";
import { uniqueNonBlank } from "../../common/strings.js";

/**
 * A plain Nostr filter object for item-definition events.
 */
export interface GameItemDefinitionFilter {
  kinds: [KindGameItemDefinition];
  authors?: string[];
  "#d"?: string[];
  "#t"?: string[];
}

export interface BuildGameItemDefinitionFilterOptions {
  /** Restrict to these item issuers. */
  authors?: string[];
  /** Restrict to these item `d` values. */
  itemIds?: string[];
  /** Restrict to items carrying these `t` topics. */
  topics?: string[];
}

/**
 * Build a generic Nostr filter for kind:31632 events.
 *
 * ## Resolving the items an inventory references
 *
 * An inventory `a` tag carries the full `31632:<issuer>:<d>` address. Group
 * those by issuer and resolve each group in one query:
 *
 * ```ts
 * buildGameItemDefinitionFilter({ authors: [issuer], itemIds: [...ds] });
 * ```
 *
 * Note that `authors` and `itemIds` combine as an intersection, so a single
 * call is only correct for one issuer at a time. Passing several issuers
 * together with several `d` values would also match an unrelated cross product
 * — issuer A's definition of issuer B's `d`. Since two issuers using the same
 * `d` are two DIFFERENT items, verify the resolved address rather than assuming
 * the relay narrowed it for you.
 *
 * ## Discovering items by category
 *
 * `t` is a single-letter indexable tag, so topic queries need no addresses at
 * all:
 *
 * ```ts
 * buildGameItemDefinitionFilter({ topics: ["edible"] });
 * ```
 *
 * This is the mechanism for category-driven behaviour — recipes, crafting
 * inputs, "what can my pet eat" — and it works across issuers. Whether to trust
 * any given issuer remains application policy; this package never decides it.
 *
 * Blank values are omitted and duplicates are removed; an option that resolves
 * to no values is left out of the filter entirely rather than emitted as an
 * empty array. Output is deterministic.
 */
export function buildGameItemDefinitionFilter(
  options: BuildGameItemDefinitionFilterOptions = {},
): GameItemDefinitionFilter {
  const filter: GameItemDefinitionFilter = {
    kinds: [KIND_GAME_ITEM_DEFINITION],
  };

  const authors = uniqueNonBlank(options.authors);
  if (authors.length > 0) {
    filter.authors = authors;
  }
  const itemIds = uniqueNonBlank(options.itemIds);
  if (itemIds.length > 0) {
    filter["#d"] = itemIds;
  }
  const topics = uniqueNonBlank(options.topics);
  if (topics.length > 0) {
    filter["#t"] = topics;
  }

  return filter;
}
