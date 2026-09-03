import { deriveGameInventoryState } from "../game-inventory-spend/derive.js";
import {
  resolveGameInventoryFoldChain,
  type ResolveGameInventoryFoldChainOptions,
} from "./chain.js";
import type {
  GameInventoryStateResolution,
  ResolveGameInventoryStateInput,
} from "./types.js";

export interface ResolveGameInventoryStateOptions extends ResolveGameInventoryFoldChainOptions {
  /**
   * Verify the chain's spend references against `spends` (default `true`).
   * Set to `false` when the supplied spends are known to exclude settled
   * ones and the caller does not want `unverified-spend` warnings.
   */
  verifySpends?: boolean;
}

/**
 * Resolve the effective state of an inventory in one step:
 *
 * ```text
 * effective = snapshot − (applicable spends not settled by the snapshot's fold chain)
 * ```
 *
 * 1. the snapshot's fold chain is walked with `resolveGameInventoryFoldChain`;
 * 2. if it resolves, `deriveGameInventoryState` is run with the chain's folded
 *    and voided ids, so nothing the snapshot already incorporates is debited
 *    again and nothing it voided can resurface;
 * 3. if it does not resolve, no state is produced.
 *
 * A snapshot with no fold reference resolves trivially: every valid spend
 * against it is pending. That is the state of every inventory written before
 * spend support existed, and it needs no manifests at all.
 *
 * This is the reader's entry point. The owner's write cycle uses the same
 * call and then `toBuildGameInventoryFoldInput(state)` and
 * `toBuildGameInventoryInput(state.inventory)`.
 */
export function resolveGameInventoryState(
  input: ResolveGameInventoryStateInput,
  options: ResolveGameInventoryStateOptions = {},
): GameInventoryStateResolution {
  const { verifySpends = true, ...chainOptions } = options;
  const chainInput = {
    inventoryAddress: input.inventory.address,
    headFoldId: input.inventory.fold?.eventId,
    folds: input.folds,
    ...(verifySpends ? { spends: input.spends } : {}),
  };
  const chain = resolveGameInventoryFoldChain(chainInput, chainOptions);
  if (chain.status !== "resolved") {
    return { status: "unresolved", chain };
  }
  const state = deriveGameInventoryState(
    {
      inventory: input.inventory,
      spends: input.spends,
      foldedSpendIds: chain.foldedSpendIds,
      voidedSpendIds: chain.voidedSpendIds,
    },
    chainOptions,
  );
  return { status: "resolved", chain, state };
}
