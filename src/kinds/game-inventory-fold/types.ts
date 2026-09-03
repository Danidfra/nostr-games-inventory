import type { NostrEvent } from "../../nostr/event.js";
import type { KindGameInventoryFold } from "../../common/constants.js";
import type { GameInventory } from "../game-inventory/types.js";
import type { GameInventoryDerivedState } from "../game-inventory-spend/types.js";

/**
 * A reference to another event from a fold manifest.
 */
export interface GameInventoryEventReference {
  eventId: string;
  /** Relay URL hint, or `""` when unknown. */
  relay: string;
}

/**
 * A parsed kind:1417 Game Inventory Fold Manifest.
 *
 * It records exactly which kind:1416 spends a kind:31633 snapshot lineage has
 * settled: `spends` were applied and are incorporated into the snapshot's
 * quantities; `voids` were rejected and are permanently not applicable.
 * `previous` links to the manifest before it for the same inventory, forming
 * an immutable chain.
 */
export interface GameInventoryFold {
  /** The event id. */
  id: string;
  kind: KindGameInventoryFold;
  /** The event author. Always equal to the referenced inventory's owner. */
  owner: string;
  createdAt: number;

  /** The inventory this manifest is scoped to: `31633:<owner>:<d>`. */
  inventoryAddress: string;
  inventoryRelay: string;

  /** The previous manifest for the same inventory, absent for the first. */
  previous?: GameInventoryEventReference;
  /** Applied spends incorporated by this manifest, in tag order. */
  spends: GameInventoryEventReference[];
  /** Rejected spends settled as void by this manifest, in tag order. */
  voids: GameInventoryEventReference[];
  /** Convenience: `spends` ids only. */
  spendIds: string[];
  /** Convenience: `voids` ids only. */
  voidIds: string[];

  alt?: string;
  /** Raw `content` string, preserved exactly as received. */
  content: string;
  /** Parsed content JSON, when content was non-empty valid JSON. */
  contentJson?: unknown;

  /** The original event this manifest was parsed from. */
  event: NostrEvent;
}

export interface BuildGameInventoryEventReferenceInput {
  eventId: string;
  relay?: string;
}

/**
 * Input for building a kind:1417 event template.
 */
export interface BuildGameInventoryFoldInput {
  /** The inventory this manifest is scoped to: a full `31633:<owner>:<d>`. */
  inventoryAddress: string;
  inventoryRelay?: string;
  /** The previous manifest for this inventory. Omit for the first manifest. */
  previous?: BuildGameInventoryEventReferenceInput;
  /** Applied spends being incorporated. */
  spends?: BuildGameInventoryEventReferenceInput[];
  /** Rejected spends being settled as void. */
  voids?: BuildGameInventoryEventReferenceInput[];
  alt?: string;
  /** Optional content; string or JSON-serializable value. Defaults to `""`. */
  content?: unknown;
  /**
   * Extra tags appended verbatim after the managed tags. Tags that conflict
   * with builder-managed tags (`a`, `e`, `alt`) are rejected.
   */
  extraTags?: string[][];
}

export type GameInventoryFoldProblemCode =
  /** The head or a `previous` manifest is not in the supplied events. */
  | "missing-fold"
  /** A manifest in the chain is not a valid kind:1417 event. */
  | "invalid-fold"
  /** A manifest in the chain is scoped to another inventory address. */
  | "wrong-inventory"
  /** A manifest in the chain is not authored by the inventory owner. */
  | "wrong-author"
  /** A manifest id was reached twice while walking `previous` links. */
  | "cycle"
  /** A referenced spend event is present but not a valid kind:1416 spend. */
  | "invalid-spend"
  /** A referenced spend is valid but debits another inventory address. */
  | "foreign-spend";

export interface GameInventoryFoldProblem {
  code: GameInventoryFoldProblemCode;
  message: string;
  /** The manifest the problem was detected on, when applicable. */
  foldId?: string;
  /** The referenced spend, when applicable. */
  spendId?: string;
}

export type GameInventoryFoldWarningCode =
  /** A spend id is referenced by more than one manifest in the chain. */
  | "refolded-spend"
  /** A spend id is listed as `spend` in one manifest and `void` in another. */
  | "contradictory-spend"
  /** A referenced spend was not among the supplied spend events. */
  | "unverified-spend";

export interface GameInventoryFoldWarning {
  code: GameInventoryFoldWarningCode;
  message: string;
  foldId?: string;
  spendId?: string;
}

export interface ResolveGameInventoryFoldChainInput {
  /** The inventory the chain must be scoped to: `31633:<owner>:<d>`. */
  inventoryAddress: string;
  /**
   * The manifest the current snapshot references. Omit (or `undefined`) for a
   * snapshot with no fold reference: the chain is then trivially resolved and
   * empty.
   */
  headFoldId?: string | undefined;
  /** Candidate kind:1417 events, in any order; unrelated ones are ignored. */
  folds: readonly NostrEvent[];
  /**
   * Optional kind:1416 events used to verify the manifests' contents. When
   * supplied, every reachable spend reference that has an event here is
   * checked for validity and inventory scope; references with no event are
   * reported as `unverified-spend` warnings, never as failures, because
   * absence from one reader's set proves nothing.
   */
  spends?: readonly NostrEvent[];
}

/**
 * The result of walking a fold chain.
 *
 * `status: "resolved"` means every manifest from the head back to the first
 * was found, valid, correctly scoped and acyclic, and the id sets below are
 * complete. `status: "unresolved"` means at least one `problems` entry blocks
 * that conclusion; the id sets then hold only what was reachable before the
 * break and MUST NOT be used to derive a balance.
 */
export interface GameInventoryFoldResolution {
  status: "resolved" | "unresolved";
  /** The head manifest id, when the snapshot referenced one. */
  headFoldId?: string;
  /** The manifests walked, head first. */
  chain: GameInventoryFold[];
  /** Every spend id incorporated by the chain. */
  foldedSpendIds: string[];
  /** Every spend id voided by the chain. */
  voidedSpendIds: string[];
  /** `foldedSpendIds` ∪ `voidedSpendIds`: nothing here is pending. */
  settledSpendIds: string[];
  /** Blocking problems. Non-empty exactly when `status` is `unresolved`. */
  problems: GameInventoryFoldProblem[];
  /** Non-blocking observations. */
  warnings: GameInventoryFoldWarning[];
}

export interface ResolveGameInventoryStateInput {
  /** The current kind:31633 snapshot. */
  inventory: GameInventory;
  /** Candidate kind:1417 events (at least the chain the snapshot references). */
  folds: readonly NostrEvent[];
  /** Candidate kind:1416 events against this inventory. */
  spends: readonly NostrEvent[];
}

/**
 * The combined result of resolving the fold chain and deriving state.
 *
 * `unresolved` carries no `state` on purpose: when the chain cannot be
 * verified, the library does not know which spends the snapshot already
 * incorporates, and any quantity it produced would be a guess in one direction
 * or the other. Fetch the missing manifests (the snapshot's fold reference and
 * each `previous` link carry relay hints) and resolve again.
 */
export type GameInventoryStateResolution =
  | {
      status: "resolved";
      chain: GameInventoryFoldResolution;
      state: GameInventoryDerivedState;
    }
  | {
      status: "unresolved";
      chain: GameInventoryFoldResolution;
    };
