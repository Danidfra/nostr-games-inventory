import type { NostrEvent } from "../../nostr/event.js";
import type { KindGameInventorySpend } from "../../common/constants.js";
import type { GameInventory } from "../game-inventory/types.js";

/**
 * A parsed kind:1416 Game Inventory Spend: an owner-signed, append-only debit
 * of `quantity` units of one item from one kind:31633 inventory.
 *
 * Identity is the event id. Both references are FULL addresses: an inventory
 * is `31633:<owner>:<d>` and an item is `31632:<issuer>:<d>`. Neither is ever
 * reduced to its `d` component.
 */
export interface GameInventorySpend {
  /** The event id — the durable identity of this spend. */
  id: string;
  kind: KindGameInventorySpend;
  /** The event author. Always equal to the referenced inventory's owner. */
  owner: string;
  /** The event `created_at`, the primary key of the deterministic order. */
  createdAt: number;

  /** The debited inventory: `31633:<owner-pubkey>:<inventory-d-tag>`. */
  inventoryAddress: string;
  /** Relay URL hint for the inventory, or `""` when unknown. */
  inventoryRelay: string;
  /** The debited item: `31632:<issuer-pubkey>:<item-d-tag>`. */
  itemAddress: string;
  /** Relay URL hint for the item definition, or `""` when unknown. */
  itemRelay: string;
  /** Positive safe integer number of units debited. */
  quantity: number;

  /** Optional free-form `purpose` tag. Never affects accounting. */
  purpose?: string;
  /** Optional `client` tag name (index 1). Never affects accounting. */
  client?: string;
  /** Optional opaque `nonce` tag. Never affects accounting. */
  nonce?: string;
  /** Optional `alt` tag. */
  alt?: string;

  /** Raw `content` string, preserved exactly as received. */
  content: string;
  /** Parsed content JSON, when content was non-empty valid JSON. */
  contentJson?: unknown;

  /** The original event this spend was parsed from. */
  event: NostrEvent;
}

/**
 * Input for building a kind:1416 event template.
 */
export interface BuildGameInventorySpendInput {
  /** The inventory to debit. Must be a full `31633:<owner>:<d>` coordinate. */
  inventoryAddress: string;
  inventoryRelay?: string;
  /** The item to debit. Must be a full `31632:<issuer>:<d>` coordinate. */
  itemAddress: string;
  itemRelay?: string;
  /** Positive safe integer. Never floored, clamped or coerced. */
  quantity: number;
  /** Optional free-form purpose. Informational only. */
  purpose?: string;
  /** Optional client name. Informational only; never an authorization. */
  client?: string;
  /**
   * Optional opaque uniqueness value.
   *
   * Two spend events with identical `pubkey`, `created_at`, `kind`, `tags`
   * and `content` have the same event id and therefore ARE the same spend.
   * A client that may legitimately sign two otherwise identical spends within
   * the same second SHOULD set a distinct nonce so they remain two spends.
   */
  nonce?: string;
  alt?: string;
  /** Optional content; string or JSON-serializable value. Defaults to `""`. */
  content?: unknown;
  /**
   * Extra tags appended verbatim after the managed tags. Tags that conflict
   * with builder-managed tags (`a`, `quantity`, `purpose`, `client`, `nonce`,
   * `alt`) are rejected.
   */
  extraTags?: string[][];
}

/**
 * The minimal shape the deterministic spend order needs. Every parsed
 * {@link GameInventorySpend} satisfies it.
 */
export interface GameInventorySpendOrderKey {
  createdAt: number;
  id: string;
}

/**
 * What happened to one candidate spend event during derivation.
 *
 * - `applied` — pending and debited; `available` is the balance before and
 *   `remaining` the balance after.
 * - `rejected` — pending, but its quantity exceeded the balance at its
 *   position in the deterministic order. Nothing was debited: no partial
 *   application and no clamping.
 * - `folded` — already incorporated into the snapshot by the fold chain.
 * - `voided` — recorded by the fold chain as permanently not applicable.
 * - `ignored` — a valid spend against a different inventory address.
 * - `invalid` — not a valid kind:1416 spend (wrong kind, wrong author, bad
 *   address, bad quantity, …). It never affects any balance.
 */
export type GameInventorySpendApplication =
  | {
      status: "applied";
      spend: GameInventorySpend;
      available: number;
      remaining: number;
    }
  | {
      status: "rejected";
      spend: GameInventorySpend;
      reason: "insufficient-quantity";
      available: number;
      requested: number;
    }
  | { status: "folded"; spend: GameInventorySpend }
  | { status: "voided"; spend: GameInventorySpend }
  | { status: "ignored"; spend: GameInventorySpend; reason: "other-inventory" }
  | { status: "invalid"; event: NostrEvent; error: string };

export interface DeriveGameInventoryStateInput {
  /** The current kind:31633 snapshot. */
  inventory: GameInventory;
  /** Candidate kind:1416 events, in any order, with or without duplicates. */
  spends: readonly NostrEvent[];
  /**
   * Spend ids the snapshot has already incorporated — normally
   * `foldedSpendIds` of a resolved fold chain. Anything listed here is never
   * debited again.
   */
  foldedSpendIds?: Iterable<string>;
  /**
   * Spend ids the fold chain has recorded as permanently not applicable —
   * normally `voidedSpendIds` of a resolved fold chain.
   */
  voidedSpendIds?: Iterable<string>;
}

/**
 * The result of deriving effective inventory state from a snapshot and a set
 * of candidate spends.
 *
 * `inventory` is the effective state: the snapshot quantities minus every
 * `applied` spend. It is a regular {@link GameInventory}, so the existing
 * mutation helpers and `toBuildGameInventoryInput` work on it unchanged.
 * Its `event` still describes the snapshot it was derived from.
 *
 * Everything else is diagnostics, all in the deterministic spend order.
 */
export interface GameInventoryDerivedState {
  /** The snapshot the derivation started from, untouched. */
  base: GameInventory;
  /** The effective inventory: `base` minus every applied spend. */
  inventory: GameInventory;
  /**
   * One entry per distinct candidate, in the deterministic order (`invalid`
   * entries last, ordered by `created_at` then id when those exist).
   */
  applications: GameInventorySpendApplication[];
  /** Pending spends that debited the balance, in order. */
  applied: GameInventorySpend[];
  /** Pending spends that overdrew and were not applied, in order. */
  rejected: GameInventorySpend[];
  /** Spends the fold chain had already incorporated. */
  folded: GameInventorySpend[];
  /** Spends the fold chain had recorded as void. */
  voided: GameInventorySpend[];
  /** Valid spends against a different inventory address. */
  ignored: GameInventorySpend[];
  /** Candidate events that are not valid spends, with the reason. */
  invalid: { event: NostrEvent; error: string }[];
  /** Event ids that appeared more than once in `spends` (relay duplicates). */
  duplicateSpendIds: string[];
}
