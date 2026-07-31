import type { NostrEvent } from "../../nostr/event.js";
import type { KindGameItemPlacement } from "../../common/constants.js";

/**
 * Type model for kind:31634 Game Item Placement.
 *
 * A placement event declares **where** items that are referenced by address are
 * currently equipped or placed. It does not define the item (kind:31632), does
 * not prove possession (kind:31633), and does not authorize itself: ownership,
 * delegation, issuer trust, slot compatibility and render policy are all
 * application decisions that live outside this library.
 *
 * ## Forward compatibility
 *
 * Every structure below carries an index signature. Unknown fields survive
 * parsing, mutation and rebuilding untouched, so a client built against this
 * version never destroys data written by a newer one. Enum-like values (modes,
 * slots, units, origins, handedness, up axes, rotation orders) are typed as
 * "known literal | any other string" so known values autocomplete while unknown
 * values stay valid.
 */

/**
 * The `Record<never, never>` intersection keeps editor autocompletion for the
 * known literals without collapsing the union to plain `string`.
 */
type OpenString<Known extends string> = Known | (string & Record<never, never>);

/* -------------------------------------------------------------------------- */
/* Modes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Placement modes recommended by this version of the spec.
 *
 * - `equip` — the item is attached to a slot on the target (a character, an
 *   avatar, a vehicle). `slot` is meaningful.
 * - `place` — the item is positioned inside the target (a room, a map, a
 *   world). `position` is meaningful.
 */
export const GAME_ITEM_PLACEMENT_MODES = ["equip", "place"] as const;

/** A placement mode defined by this version of the spec. */
export type GameItemPlacementMode = (typeof GAME_ITEM_PLACEMENT_MODES)[number];

/**
 * A placement mode as it appears on the wire: one of
 * {@link GameItemPlacementMode}, or any other string for modes this version
 * does not define. Unknown modes remain valid.
 */
export type GameItemPlacementModeValue = OpenString<GameItemPlacementMode>;

/* -------------------------------------------------------------------------- */
/* Targets                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A target that references another Nostr addressable event, for example a
 * character, a house or a map published as its own addressable event.
 *
 * `address` MUST be a well-formed `<kind>:<pubkey>:<d>` coordinate. Which kinds
 * are acceptable targets is an application decision; this library does not
 * restrict it.
 */
export interface GameItemPlacementAddressTarget {
  type: "address";
  address: string;
  /** Relay URL hint for the target address. */
  relay?: string;
  [key: string]: unknown;
}

/**
 * A target that is internal to the publishing application, for example a room
 * id or a local map id that has no addressable event of its own.
 */
export interface GameItemPlacementInternalTarget {
  type: "internal";
  id: string;
  [key: string]: unknown;
}

/**
 * A target whose `type` this version does not define.
 *
 * Preserved verbatim rather than rejected, so a placement written against a
 * newer spec still parses. Builders cannot derive a canonical target tag from
 * it (see `buildGameItemPlacementEvent`).
 */
export interface GameItemPlacementUnknownTarget {
  type: string;
  [key: string]: unknown;
}

/**
 * The authoritative target of a placement document, as declared in `content`.
 *
 * Note that the unknown-target member makes this union structurally open: an
 * object literal with a `type` string and nothing else type-checks. Shape is
 * enforced at runtime instead — parsers reject a malformed known target and
 * builders throw on one.
 */
export type GameItemPlacementTarget =
  | GameItemPlacementAddressTarget
  | GameItemPlacementInternalTarget
  | GameItemPlacementUnknownTarget;

/* -------------------------------------------------------------------------- */
/* Reference coordinate systems                                               */
/* -------------------------------------------------------------------------- */

/** Measurement unit of a reference coordinate system. */
export type GameItemPlacementUnitValue = OpenString<
  "percent" | "normalized" | "pixels" | "meters"
>;

/** Origin of a reference coordinate system. */
export type GameItemPlacementOriginValue = OpenString<
  "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center"
>;

/** Handedness of a 3D reference coordinate system. */
export type GameItemPlacementHandednessValue = OpenString<
  "right-handed" | "left-handed"
>;

/** Up axis of a 3D reference coordinate system. */
export type GameItemPlacementAxisValue = OpenString<"x" | "y" | "z">;

/**
 * A 2D reference coordinate system.
 *
 * `width` and `height` describe the coordinate space the entries' positions are
 * expressed in — for example `100 x 100` with `unit: "percent"`, or `1 x 1`
 * with `unit: "normalized"`. Coordinates are never normalized or converted by
 * this library; interpretation belongs to the renderer.
 */
export interface GameItemPlacement2DReference {
  space: "2d";
  unit: GameItemPlacementUnitValue;
  origin: GameItemPlacementOriginValue;
  width: number;
  height: number;
  [key: string]: unknown;
}

/**
 * A 3D reference coordinate system.
 *
 * Unlike the 2D form there are no required extents: a 3D world is usually
 * unbounded. When a 3D reference is declared, entry positions MUST carry a `z`
 * component.
 */
export interface GameItemPlacement3DReference {
  space: "3d";
  unit: GameItemPlacementUnitValue;
  origin: GameItemPlacementOriginValue;
  handedness?: GameItemPlacementHandednessValue;
  upAxis?: GameItemPlacementAxisValue;
  [key: string]: unknown;
}

/**
 * A reference coordinate system whose `space` this version does not define.
 * Preserved verbatim; consumers that do not recognize it should ignore the
 * spatial fields rather than guess.
 */
export interface GameItemPlacementUnknownReference {
  space: string;
  [key: string]: unknown;
}

/** The coordinate system placement transforms are expressed in. */
export type GameItemPlacementReference =
  | GameItemPlacement2DReference
  | GameItemPlacement3DReference
  | GameItemPlacementUnknownReference;

/* -------------------------------------------------------------------------- */
/* Transforms                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A position in the declared reference coordinate system.
 *
 * `x` and `y` are required and MUST be finite. `z` is required when the
 * document declares a 3D reference, and optional otherwise. Values are never
 * clamped, rounded or converted.
 */
export interface GameItemPlacementPosition {
  x: number;
  y: number;
  z?: number;
  [key: string]: unknown;
}

/** Rotation unit for a Euler rotation. */
export type GameItemPlacementRotationUnitValue = OpenString<
  "degrees" | "radians"
>;

/** Axis order for a Euler rotation. */
export type GameItemPlacementRotationOrderValue = OpenString<
  "xyz" | "xzy" | "yxz" | "yzx" | "zxy" | "zyx"
>;

/**
 * A Euler rotation.
 *
 * Every component is optional so a 2D placement can carry `z` alone, which is
 * the ordinary "rotate the sprite" case. Provided components MUST be finite.
 */
export interface GameItemPlacementEulerRotation {
  type: "euler";
  unit: GameItemPlacementRotationUnitValue;
  order?: GameItemPlacementRotationOrderValue;
  x?: number;
  y?: number;
  z?: number;
  [key: string]: unknown;
}

/**
 * A quaternion rotation.
 *
 * All four components are required and MUST be finite. A zero-length
 * quaternion (all components `0`) describes no rotation at all and is rejected.
 * Quaternions are never normalized by this library, and unit length is not
 * required.
 */
export interface GameItemPlacementQuaternionRotation {
  type: "quaternion";
  x: number;
  y: number;
  z: number;
  w: number;
  [key: string]: unknown;
}

/**
 * A rotation whose `type` this version does not define. Preserved verbatim.
 */
export interface GameItemPlacementUnknownRotation {
  type: string;
  [key: string]: unknown;
}

export type GameItemPlacementRotation =
  | GameItemPlacementEulerRotation
  | GameItemPlacementQuaternionRotation
  | GameItemPlacementUnknownRotation;

/**
 * A scale factor.
 *
 * `x` and `y` are required; `z` is optional so the same structure covers 2D and
 * 3D. All provided values MUST be finite. Zero and negative values are allowed:
 * they are legitimate ways to hide or mirror an item, and this library has no
 * general rule against them.
 */
export interface GameItemPlacementScale {
  x: number;
  y: number;
  z?: number;
  [key: string]: unknown;
}

/**
 * Axis mirroring. Both components are required and MUST be booleans.
 */
export interface GameItemPlacementFlip {
  x: boolean;
  y: boolean;
  [key: string]: unknown;
}

/* -------------------------------------------------------------------------- */
/* Placement entries                                                          */
/* -------------------------------------------------------------------------- */

/**
 * A single placed or equipped item.
 *
 * `id`, `item` and `mode` are required. Everything else is optional, and every
 * field this version does not define is preserved.
 *
 * This library never decides whether the entry *should* exist: it does not
 * check that the author owns the item, that the item is in any inventory, that
 * the issuer is trusted, or that the item fits the slot.
 */
export interface GameItemPlacementEntry {
  /** Stable identifier for this entry inside the placement document. */
  id: string;
  /** The placed item's `31632:<issuer-pubkey>:<item-d>` address. */
  item: string;
  /** `equip`, `place`, or any application-defined mode. */
  mode: GameItemPlacementModeValue;
  /** Attachment slot. Meaningful for `equip`; free-form and never validated. */
  slot?: string;
  position?: GameItemPlacementPosition;
  rotation?: GameItemPlacementRotation;
  scale?: GameItemPlacementScale;
  flip?: GameItemPlacementFlip;
  /** Draw order hint. Finite; not required to be an integer. */
  layer?: number;
  /** Target form this entry applies to (for example a character life stage). */
  form?: string;
  /**
   * Target view this entry applies to. Values usually match the kind:31632
   * image view markers (`front`, `side-right`, …) but any string is valid.
   */
  view?: string;
  /** Arbitrary application metadata. Never interpreted by this library. */
  metadata?: unknown;
  [key: string]: unknown;
}

/* -------------------------------------------------------------------------- */
/* Content                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The `content` document of a kind:31634 event.
 *
 * Unlike kind:31632 and kind:31633 — where tags are the source of truth and
 * `content` is optional metadata — a placement event carries its state *in*
 * `content`. `content` MUST therefore be a JSON object; the `a` tags are a
 * derived index that lets relays answer `#a` queries.
 */
export interface GameItemPlacementContent {
  /** Advisory schema version. Non-negative safe integer when present. */
  version?: number;
  /**
   * Advisory state counter. Non-negative safe integer when present.
   *
   * It does not replace Nostr addressable-event resolution; see
   * `compareGameItemPlacementRevisions`.
   */
  revision?: number;
  /** The authoritative target of this placement document. */
  target?: GameItemPlacementTarget;
  /** The coordinate system entry transforms are expressed in. */
  reference?: GameItemPlacementReference;
  /** The placement entries. May be empty. */
  placements: GameItemPlacementEntry[];
  [key: string]: unknown;
}

/* -------------------------------------------------------------------------- */
/* Tag metadata                                                               */
/* -------------------------------------------------------------------------- */

/**
 * An `["a", "<item-address>", "<relay>", "item"]` tag as written on the event.
 *
 * Item tags are a derived index. `content.placements` is authoritative; a tag
 * without a matching placement is not a placement.
 */
export interface GameItemPlacementItemTag {
  /** The referenced item address, exactly as written. */
  address: string;
  /** Relay URL hint, or `""` when unknown. */
  relay: string;
  /** The raw tag. */
  tag: string[];
}

/**
 * A target relationship as written in the tags, exposed as metadata.
 *
 * `address` tags are `["a", "<address>", "<relay>", "target"]`; `internal` tags
 * are `["target", "<internal-id>"]`.
 */
export interface GameItemPlacementTargetTag {
  type: "address" | "internal";
  /** The target address, or the internal target id. */
  value: string;
  /** Relay URL hint for address targets, or `""`. */
  relay: string;
  /** The raw tag. */
  tag: string[];
}

/* -------------------------------------------------------------------------- */
/* Parsed placement                                                           */
/* -------------------------------------------------------------------------- */

/**
 * A parsed kind:31634 Game Item Placement.
 *
 * The placement identity (`id` / `address`) is the identity of the *document*,
 * not of the target: a `d` value is never assumed to equal a character id, room
 * id, map id or target id.
 */
export interface GameItemPlacement {
  /** The `d` tag value (placement document identifier). */
  id: string;
  /** The full addressable coordinate `31634:<pubkey>:<d>`. */
  address: string;
  /** The event author. This library never checks what the author may modify. */
  author: string;
  kind: KindGameItemPlacement;

  /** All `context` tag values (repeatable). */
  contexts: string[];
  /** All `t` topic tag values (repeatable). */
  topics: string[];
  /** Optional `alt` tag. */
  alt?: string;

  /**
   * The authoritative target declared in `content`, when present.
   *
   * When absent, {@link GameItemPlacement.targetTags} may still describe a
   * target relationship, but only as unauthenticated tag metadata.
   */
  target?: GameItemPlacementTarget;
  /** Target relationships found in the tags, in tag order. */
  targetTags: GameItemPlacementTargetTag[];

  /** The declared reference coordinate system, when valid and present. */
  reference?: GameItemPlacementReference;
  /** Advisory `content.version`. */
  version?: number;
  /** Advisory `content.revision`. */
  revision?: number;

  /**
   * Valid placement entries in source order.
   *
   * In permissive mode malformed entries are omitted here and reported as
   * `invalid-placement-entry` warnings; the original entries remain available
   * through {@link GameItemPlacement.contentJson}.
   */
  placements: GameItemPlacementEntry[];
  /**
   * Unique item addresses referenced by {@link GameItemPlacement.placements},
   * in first-placement order. This is what a canonical builder derives the
   * `item` tags from.
   */
  itemAddresses: string[];
  /** `a` tags carrying the `item` marker, in tag order. */
  itemTags: GameItemPlacementItemTag[];

  /** Raw `content` string, preserved exactly as received. */
  content: string;
  /**
   * The full parsed `content` object, preserved verbatim.
   *
   * This is the round-trip and repair escape hatch: it contains every unknown
   * top-level field *and* the original `placements` array including entries
   * that were rejected as malformed.
   */
  contentJson: Record<string, unknown>;

  /** The original event this placement was parsed from. */
  event: NostrEvent;
}

/* -------------------------------------------------------------------------- */
/* Builder input                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Input for building an unsigned kind:31634 event template.
 *
 * See `buildGameItemPlacementEvent` for the managed-tag policy, and
 * `toBuildGameItemPlacementInput` for turning a parsed placement back into this
 * shape without losing unknown data.
 */
export interface BuildGameItemPlacementInput {
  /** The `d` placement document identifier. Required, non-empty. */
  id: string;

  /** The authoritative target. Optional; a placement need not declare one. */
  target?: GameItemPlacementTarget;
  /** The reference coordinate system. */
  reference?: GameItemPlacementReference;
  /** Placement entries. Defaults to an empty list. */
  placements?: GameItemPlacementEntry[];
  /** Advisory schema version. Non-negative safe integer. */
  version?: number;
  /** Advisory state counter. Non-negative safe integer. */
  revision?: number;
  /**
   * Extra top-level `content` fields, emitted verbatim after the managed ones.
   *
   * Keys managed by the builder (`version`, `revision`, `target`, `reference`,
   * `placements`) are rejected here rather than silently overwritten.
   */
  contentExtra?: Record<string, unknown>;

  /** Repeatable `context` tag values. */
  contexts?: string[];
  /** Repeatable `t` topic tag values. */
  topics?: string[];
  /** Optional `alt` tag. Never auto-generated. */
  alt?: string;

  /**
   * Relay hints keyed by address, used when deriving `item` tags and an
   * address target tag. Falls back to a preserved matching tag's relay, then
   * to `""`.
   */
  relays?: Record<string, string>;

  /**
   * Tags from a source event to carry over, typically `placement.event.tags`.
   *
   * Stale builder-managed tags are stripped before the managed tags are
   * regenerated; unrelated tags — including `a` tags with other markers or no
   * marker — are preserved in their original relative order.
   */
  preserveTags?: string[][];
  /**
   * Extra tags appended verbatim after the managed tags.
   *
   * Unlike {@link BuildGameItemPlacementInput.preserveTags}, a tag that
   * conflicts with a builder-managed tag is REJECTED here (the builder throws)
   * rather than stripped, matching the other builders in this package.
   */
  extraTags?: string[][];
}
