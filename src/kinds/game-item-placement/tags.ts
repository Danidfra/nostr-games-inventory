import type { NostrEvent } from "../../nostr/event.js";
import { isBlank, uniqueNonBlank } from "../../common/strings.js";
import {
  KIND_GAME_ITEM_PLACEMENT,
  type KindGameItemPlacement,
} from "../../common/constants.js";
import {
  PLACEMENT_ITEM_MARKER,
  PLACEMENT_TARGET_MARKER,
  PLACEMENT_TARGET_TAG,
} from "./address.js";
import type {
  GameItemPlacementItemTag,
  GameItemPlacementTargetTag,
} from "./types.js";

/**
 * Tag-level helpers for kind:31634.
 *
 * The tags of a placement event are a derived index, not the state:
 * `content.placements` is authoritative. These helpers exist so callers can
 * build relay queries and then finish the job locally.
 */

function tagsOf(source: NostrEvent | string[][]): string[][] {
  return Array.isArray(source) ? source : source.tags;
}

/**
 * `true` when the tag is an `["a", "<item-address>", "<relay>", "item"]`
 * item reference.
 *
 * An `a` tag with no marker, or with any other marker, is an unrelated
 * relationship and MUST NOT be treated as an item placement.
 */
export function isPlacementItemTag(tag: string[]): boolean {
  return (
    tag[0] === "a" &&
    tag[3] === PLACEMENT_ITEM_MARKER &&
    typeof tag[1] === "string" &&
    !isBlank(tag[1])
  );
}

/**
 * `true` when the tag declares the placement's target: either
 * `["a", "<address>", "<relay>", "target"]` or `["target", "<internal-id>"]`.
 */
export function isPlacementTargetTag(tag: string[]): boolean {
  if (tag[0] === "a") {
    return (
      tag[3] === PLACEMENT_TARGET_MARKER &&
      typeof tag[1] === "string" &&
      !isBlank(tag[1])
    );
  }
  return (
    tag[0] === PLACEMENT_TARGET_TAG &&
    typeof tag[1] === "string" &&
    !isBlank(tag[1])
  );
}

/**
 * Collect every `item`-marked `a` tag, in tag order.
 *
 * Duplicates are returned as they appear; reconciling them against
 * `content.placements` is the parser's job.
 */
export function getPlacementItemTags(
  source: NostrEvent | string[][],
): GameItemPlacementItemTag[] {
  const items: GameItemPlacementItemTag[] = [];
  for (const tag of tagsOf(source)) {
    if (!isPlacementItemTag(tag)) {
      continue;
    }
    items.push({
      address: tag[1] as string,
      relay: tag[2] ?? "",
      tag: [...tag],
    });
  }
  return items;
}

/**
 * Collect every target relationship declared in the tags, in tag order.
 *
 * These are metadata. When `content.target` is present it is authoritative and
 * these tags are only a derived index; when it is absent they are the sole
 * (unauthenticated) hint about what the placement applies to.
 */
export function getPlacementTargetTags(
  source: NostrEvent | string[][],
): GameItemPlacementTargetTag[] {
  const targets: GameItemPlacementTargetTag[] = [];
  for (const tag of tagsOf(source)) {
    if (!isPlacementTargetTag(tag)) {
      continue;
    }
    targets.push(
      tag[0] === "a"
        ? {
            type: "address",
            value: tag[1] as string,
            relay: tag[2] ?? "",
            tag: [...tag],
          }
        : {
            type: "internal",
            value: tag[1] as string,
            relay: "",
            tag: [...tag],
          },
    );
  }
  return targets;
}

/**
 * A plain Nostr filter object for placement events.
 *
 * Deliberately structural: this library has no relay or SDK dependency, so the
 * filter is a value you hand to whatever client you already use.
 */
export interface GameItemPlacementFilter {
  kinds: [KindGameItemPlacement];
  authors?: string[];
  "#d"?: string[];
  "#a"?: string[];
}

export interface BuildGameItemPlacementFilterOptions {
  /** Restrict to these authors. */
  authors?: string[];
  /** Restrict to these placement `d` values. */
  placementIds?: string[];
  /**
   * Restrict to placements referencing these addresses through an `a` tag.
   * Item addresses and target addresses both live in `#a`.
   */
  addresses?: string[];
}

/**
 * Build a generic Nostr filter for kind:31634 events.
 *
 * IMPORTANT: standard relays filter `#a` by **value only** — they cannot filter
 * by tag marker. A filter built from item addresses will therefore also match
 * events that reference the same address as their *target*, or through some
 * unrelated `a` relationship. Callers MUST narrow the result locally, with
 * {@link filterEventsByPlacementItemAddress} or by parsing the events and
 * reading `content.placements`, which is the authoritative source anyway.
 *
 * Blank values are omitted and duplicates are removed; an option that resolves
 * to no values is left out of the filter entirely rather than emitted as an
 * empty array, which most relays treat as "match nothing".
 */
export function buildGameItemPlacementFilter(
  options: BuildGameItemPlacementFilterOptions = {},
): GameItemPlacementFilter {
  const filter: GameItemPlacementFilter = {
    kinds: [KIND_GAME_ITEM_PLACEMENT],
  };

  const authors = uniqueNonBlank(options.authors);
  if (authors.length > 0) {
    filter.authors = authors;
  }
  const placementIds = uniqueNonBlank(options.placementIds);
  if (placementIds.length > 0) {
    filter["#d"] = placementIds;
  }
  const addresses = uniqueNonBlank(options.addresses);
  if (addresses.length > 0) {
    filter["#a"] = addresses;
  }

  return filter;
}

/**
 * Locally narrow relay results to events that reference `itemAddress` through
 * an `item`-marked `a` tag.
 *
 * This is the marker filtering relays cannot do. It still only inspects tags:
 * an event whose tags are stale relative to its content is reported by the
 * parser as `missing-item-tag` / `orphaned-item-tag`.
 */
export function filterEventsByPlacementItemAddress(
  events: readonly NostrEvent[],
  itemAddress: string,
): NostrEvent[] {
  return events.filter((event) =>
    event.tags.some((tag) => isPlacementItemTag(tag) && tag[1] === itemAddress),
  );
}
