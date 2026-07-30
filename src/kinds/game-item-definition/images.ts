/**
 * Image (media) support for kind:31632 Game Item Definitions.
 *
 * The wire format is a repeatable `image` tag:
 *
 * ```
 * ["image", "<url>"]            // primary / default image (no marker)
 * ["image", "<url>", "<marker>"] // additional view
 * ```
 *
 * There is no separate `thumb` tag, and no spritesheet/turnaround format, in
 * this version of the spec.
 */

/**
 * View markers defined by this version of the spec.
 *
 * Clients MAY encounter other markers and MUST tolerate them; unknown markers
 * are preserved verbatim rather than dropped or coerced.
 */
export const GAME_ITEM_IMAGE_MARKERS = [
  "front",
  "side-right",
  "side-left",
  "back",
  "diagonal-front-right",
  "diagonal-front-left",
] as const;

/** A view marker defined by this version of the spec. */
export type GameItemImageMarker = (typeof GAME_ITEM_IMAGE_MARKERS)[number];

/**
 * A view marker as it appears on the wire: one of {@link GameItemImageMarker}
 * for known views, or any other string for markers this version does not
 * define.
 *
 * The `Record<never, never>` intersection is the standard trick that keeps
 * editor autocompletion for the known markers without narrowing the type: a
 * plain `GameItemImageMarker | string` union collapses to `string`.
 */
export type GameItemImageMarkerValue =
  GameItemImageMarker | (string & Record<never, never>);

/**
 * A single `image` tag.
 *
 * `marker` is absent for the primary/default image (an `image` tag with no
 * marker slot, or with a blank one). When present it is the raw index-2 value:
 * it is one of {@link GameItemImageMarker} for known views, and any other
 * string for markers this version does not define. Use
 * {@link isGameItemImageMarker} to narrow to the known union.
 */
export interface GameItemImage {
  /** The image URL, always non-empty. */
  url: string;
  /** The view marker, when the tag carries a non-blank one. */
  marker?: GameItemImageMarkerValue;
}

/**
 * The minimal shape the image helpers need. Every parsed
 * `GameItemDefinition` satisfies it.
 */
export interface GameItemImageSource {
  images: readonly GameItemImage[];
}

/** Narrow an arbitrary marker string to the known marker union. */
export function isGameItemImageMarker(
  value: unknown,
): value is GameItemImageMarker {
  return (
    typeof value === "string" &&
    (GAME_ITEM_IMAGE_MARKERS as readonly string[]).includes(value)
  );
}

/**
 * Select the primary/default image from a list of parsed image tags.
 *
 * The first unmarked image wins. When every image carries a marker, the first
 * image is used as a fallback so a definition that only ships marked views
 * still renders. Returns `undefined` for an empty list.
 *
 * This is the single rule used by both the parser (to populate
 * `GameItemDefinition.image`) and {@link getPrimaryItemImage}.
 */
export function selectPrimaryGameItemImage(
  images: readonly GameItemImage[],
): GameItemImage | undefined {
  return images.find((image) => image.marker === undefined) ?? images[0];
}

/**
 * Return the URL of the item's primary/default image, or `undefined` when the
 * item has no valid image tag.
 *
 * Inventory and other list UIs SHOULD use this image.
 */
export function getPrimaryItemImage(
  item: GameItemImageSource,
): string | undefined {
  return selectPrimaryGameItemImage(item.images)?.url;
}

/**
 * Return the first image carrying the given view marker, or `undefined`.
 *
 * Unknown markers are matched exactly as written, so this also works for
 * markers this version does not define.
 */
export function getItemImageByMarker(
  item: GameItemImageSource,
  marker: GameItemImageMarkerValue,
): GameItemImage | undefined {
  return item.images.find((image) => image.marker === marker);
}

/** Return every image carrying the given view marker, in tag order. */
export function getItemImagesByMarker(
  item: GameItemImageSource,
  marker: GameItemImageMarkerValue,
): GameItemImage[] {
  return item.images.filter((image) => image.marker === marker);
}
