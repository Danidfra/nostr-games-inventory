import type { NostrEvent } from "../../nostr/event.js";
import type { KindGameItemDefinition } from "../../common/constants.js";

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
  /** Optional `image` tag. */
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
  image?: string;
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
