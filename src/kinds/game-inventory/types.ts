import type { NostrEvent } from "../../nostr/event.js";
import type { KindGameInventory } from "../../common/constants.js";

/**
 * A single item reference inside an inventory.
 */
export interface GameInventoryItem {
  /** The referenced `31632:<issuer-pubkey>:<item-d-tag>` address. */
  address: string;
  /** Relay URL hint, or `""` when unknown. */
  relay: string;
  /** Positive integer quantity. */
  quantity: number;
}

/**
 * A grant / receipt reference declared with an `e` tag marked `grant`.
 */
export interface GameInventoryGrantReference {
  /** The referenced grant event id. */
  eventId: string;
  /** Relay URL hint, or `""` when unknown. */
  relay: string;
}

/**
 * A parsed kind:31633 Game Inventory.
 *
 * Tags are the source of truth. `content` holds the raw content string; parsed
 * JSON is exposed separately via {@link GameInventory.contentJson}.
 */
export interface GameInventory {
  /** The `d` tag value (inventory context identifier). */
  id: string;
  /** The full addressable coordinate `31633:<owner>:<d>`. */
  address: string;
  /** The event author / inventory owner. */
  owner: string;
  kind: KindGameInventory;

  /** All `context` tag values (repeatable). */
  contexts: string[];
  /** Optional `name` tag. */
  name?: string;
  /** Optional `alt` tag. */
  alt?: string;

  /** Valid item references, in tag order (after duplicate resolution). */
  items: GameInventoryItem[];
  /** Grant references from `e` tags marked `grant`. */
  grants: GameInventoryGrantReference[];
  /** Convenience: grant event ids only. */
  grantEventIds: string[];

  /** Raw `content` string, preserved exactly as received. */
  content: string;
  /** Parsed content JSON, when content was non-empty valid JSON. */
  contentJson?: unknown;

  /** The original event this inventory was parsed from. */
  event: NostrEvent;
}

/**
 * Input for a single item when building an inventory event.
 *
 * `quantity` must be a non-negative safe integer. `0` omits the item; negative,
 * decimal, NaN, Infinity, and unsafe-integer values throw. Quantities are never
 * floored, clamped, or silently dropped.
 */
export interface BuildGameInventoryItemInput {
  address: string;
  relay?: string;
  quantity: number;
}

export interface BuildGameInventoryGrantInput {
  eventId: string;
  relay?: string;
}

/**
 * Strategy for handling duplicate item addresses when building or parsing.
 *
 * - `last` (spec default): keep the last valid quantity.
 * - `sum`: sum all valid quantities for the address.
 * - `strict`: reject (build throws / parse returns error).
 */
export type DuplicateStrategy = "last" | "sum" | "strict";

/**
 * Input for building a kind:31633 event template.
 */
export interface BuildGameInventoryInput {
  /** The `d` inventory identifier. Required, non-empty. */
  id: string;
  items?: BuildGameInventoryItemInput[];
  contexts?: string[];
  name?: string;
  alt?: string;
  grants?: BuildGameInventoryGrantInput[];
  /** Optional content; string or JSON-serializable value. Defaults to `""`. */
  content?: unknown;
  /**
   * How to handle duplicate item addresses in the input. Defaults to `last`
   * (the spec's recommended default). `strict` throws on duplicates. `sum`
   * throws if the summed quantity exceeds Number.MAX_SAFE_INTEGER.
   */
  duplicateStrategy?: DuplicateStrategy;
  /**
   * Extra tags appended verbatim after managed tags.
   *
   * Tags that conflict with builder-managed tags are REJECTED (the builder
   * throws), not silently duplicated. Rejected: `d`, `context`, `name`, `alt`;
   * every `a` tag (all `a` tags represent inventory items in kind:31633 — pass
   * items via `items`); and `e` tags carrying the `grant` marker (pass grants
   * via `grants`). Unrelated forward-compatible tags, including non-grant `e`
   * tags, are allowed.
   */
  extraTags?: string[][];
}
