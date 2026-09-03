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
 * A reference to the kind:1417 fold manifest this snapshot incorporates,
 * declared with an `e` tag marked `fold`.
 *
 * The quantities of a snapshot carrying this reference already account for
 * every spend listed in the manifest and every spend reachable through the
 * manifest's `previous` chain. See `docs/1416-1417-game-inventory-spend.md`.
 */
export interface GameInventoryFoldReference {
  /** The referenced fold manifest event id. */
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
  /**
   * The advisory `revision` counter, when the event carried a valid one.
   *
   * `undefined` when the tag is absent, or (in permissive mode) when it was
   * present but malformed — in which case an `invalid-revision` warning is
   * reported. See {@link compareGameInventoryRevisions} for what a revision
   * does and does not guarantee.
   */
  revision?: number;

  /** Valid item references, in tag order (after duplicate resolution). */
  items: GameInventoryItem[];
  /** Grant references from `e` tags marked `grant`. */
  grants: GameInventoryGrantReference[];
  /** Convenience: grant event ids only. */
  grantEventIds: string[];
  /**
   * The fold manifest reference from the `e` tag marked `fold`, when present.
   *
   * Absent on every inventory written before spend support existed and on
   * every inventory that has never folded a spend. Absence means "no spend has
   * been incorporated": readers that support kind:1416 treat every valid spend
   * against this inventory as pending.
   */
  fold?: GameInventoryFoldReference;

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
 * Input for the optional fold manifest reference, emitted as
 * `["e", "<fold-manifest-id>", "<relay-url>", "fold"]`.
 */
export interface BuildGameInventoryFoldReferenceInput {
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
  /**
   * The kind:1417 fold manifest whose spends this snapshot's quantities
   * already incorporate. Omit it for an inventory that has never folded a
   * spend.
   *
   * A snapshot that incorporates newly folded spends MUST reference the new
   * manifest; a snapshot that folds nothing new MUST keep referencing the
   * manifest its base referenced (the round-trip via
   * {@link toBuildGameInventoryInput} carries it over). Dropping the reference
   * makes every spend in the chain pending again and double-debits the owner.
   */
  fold?: BuildGameInventoryFoldReferenceInput;
  /** Optional content; string or JSON-serializable value. Defaults to `""`. */
  content?: unknown;
  /**
   * Advisory revision counter, emitted as a `["revision", "<n>"]` tag.
   *
   * Must be a non-negative safe integer; anything else throws. Omit it to emit
   * no revision tag at all. A writer that wants conflict detection reads the
   * base inventory and publishes `(base.revision ?? 0) + 1`.
   */
  revision?: number;
  /**
   * Tags from the event being replaced (typically `inventory.event.tags`),
   * carried over with stale builder-managed tags stripped.
   *
   * This is the mechanism that stops a rewrite from destroying data belonging
   * to another client. kind:31633 is a replaceable event: a publish replaces
   * the whole tag list, so any tag this builder does not regenerate and the
   * caller does not preserve is gone permanently. Prefer
   * {@link toBuildGameInventoryInput}, which populates this for you.
   *
   * Stripped as stale (they are regenerated from the structured fields):
   * `d`, `revision`, `context`, `name`, `alt`, every `a` tag, and `e` tags
   * carrying the `grant` or `fold` marker. Everything else survives in its
   * original relative order.
   */
  preserveTags?: string[][];
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
   * throws), not silently duplicated. Rejected: `d`, `revision`, `context`,
   * `name`, `alt`;
   * every `a` tag (all `a` tags represent inventory items in kind:31633 — pass
   * items via `items`); `e` tags carrying the `grant` marker (pass grants via
   * `grants`); and `e` tags carrying the `fold` marker (pass the reference via
   * `fold`). Unrelated forward-compatible tags, including other `e` tags, are
   * allowed.
   */
  extraTags?: string[][];
}
