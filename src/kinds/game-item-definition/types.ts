import type { NostrEvent } from "../../nostr/event.js";
import type { KindGameItemDefinition } from "../../common/constants.js";
import type { GameItemImage } from "./images.js";

/**
 * A derivation reference declared with an `a` tag marked `based_on`.
 */
export interface GameItemBasedOnReference {
  /** The referenced `31632:<pubkey>:<d>` address (as written in the tag). */
  address: string;
  /** Relay URL hint, or `""` when unknown. */
  relay: string;
}

/**
 * A parsed kind:31632 Game Item Definition.
 *
 * Tags are the source of truth. `content` holds the raw content string; parsed
 * JSON is exposed separately via {@link GameItemDefinition.contentJson}.
 */
export interface GameItemDefinition {
  /** The `d` tag value (item identifier). */
  id: string;
  /** The full addressable coordinate `31632:<pubkey>:<d>`. */
  address: string;
  /** The event author / item issuer. */
  issuer: string;
  kind: KindGameItemDefinition;

  /** Required `name` tag. */
  name: string;
  /** Required `type` tag. */
  type: string;

  /** Optional `category` tag. */
  category?: string;
  /**
   * The primary/default image URL: the first `image` tag with no view marker,
   * falling back to the first valid `image` tag when every image is marked.
   * `undefined` when the item has no valid `image` tag.
   *
   * Inventory and list UIs SHOULD use this image.
   */
  image?: string;
  /** Optional `model_3d` tag. */
  model3d?: string;
  /** Optional `audio` tag. */
  audio?: string;
  /** Optional `symbol` tag. */
  symbol?: string;
  /** Optional `rarity` tag. */
  rarity?: string;
  /** Optional `max_stack` tag, kept as the raw string per the spec. */
  maxStack?: string;
  /** Optional `version` tag. */
  version?: string;
  /** Optional `alt` tag. */
  alt?: string;

  /**
   * Every valid `image` tag in tag order, including the primary image and any
   * marked views. Image tags with a missing or blank URL are ignored.
   */
  images: GameItemImage[];
  /** All `context` tag values (repeatable). */
  contexts: string[];
  /** All `t` topic tag values (repeatable). */
  topics: string[];
  /** All `based_on` derivation references (repeatable). */
  basedOn: GameItemBasedOnReference[];

  /** Raw `content` string, preserved exactly as received. */
  content: string;
  /**
   * Parsed content JSON, when `content` was non-empty valid JSON. `undefined`
   * when content is empty or (in permissive mode) invalid JSON.
   */
  contentJson?: unknown;

  /** The original event this definition was parsed from. */
  event: NostrEvent;
}

/**
 * Input for building a kind:31632 event template.
 *
 * `content` accepts either a preserialized string or any JSON-serializable
 * value. Tag-owned fields (name, type, etc.) MUST NOT be duplicated in content
 * by the library; that is left to the caller's discretion per the spec.
 */
export interface BuildGameItemDefinitionInput {
  /** The `d` item identifier. Required, non-empty. */
  id: string;
  /** The `name` tag. Required, non-empty. */
  name: string;
  /** The `type` tag. Required, non-empty. */
  type: string;

  category?: string;
  /**
   * The primary/default image, emitted as an unmarked `["image", "<url>"]`
   * tag. May also be supplied as an unmarked entry in {@link images}.
   */
  image?: string;
  /**
   * Additional image tags. Entries with a marker are emitted as
   * `["image", "<url>", "<marker>"]` view tags; an unmarked entry is treated
   * as the primary image (equivalent to {@link image}).
   *
   * Entries with a blank URL are omitted, like other repeatable values.
   * Exact duplicates (same URL and marker) are emitted only once. Supplying
   * two different unmarked URLs — whether across `image` and `images` or
   * within `images` — is an ambiguous primary image and throws.
   */
  images?: GameItemImage[];
  model3d?: string;
  audio?: string;
  symbol?: string;
  rarity?: string;
  /** Suggested max stack; coerced to a string if provided as a number. */
  maxStack?: string | number;
  version?: string | number;
  /**
   * Human-readable fallback. If omitted, the builder does NOT auto-generate an
   * `alt` tag (it is only RECOMMENDED by the spec). Pass a string to include it.
   */
  alt?: string;

  contexts?: string[];
  topics?: string[];
  basedOn?: GameItemBasedOnReference[];

  /** Optional content; string or JSON-serializable value. Defaults to `""`. */
  content?: unknown;

  /**
   * Extra tags to append verbatim after the managed tags. Use for
   * forward-compatible or game-specific tags.
   *
   * Tags that conflict with builder-managed tags are REJECTED (the builder
   * throws), not silently ignored or duplicated. Managed tags are: `d`,
   * `name`, `type`, `category`, `image`, `model_3d`, `audio`, `symbol`,
   * `rarity`, `max_stack`, `version`, `context`, `t`, `alt`. An `a` tag only
   * conflicts when it carries the `based_on` marker (pass such references via
   * `basedOn` instead); other `a` usages remain allowed.
   */
  extraTags?: string[][];
}
