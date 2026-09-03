import type { GameInventorySpendOrderKey } from "./types.js";

/**
 * The normative deterministic order of kind:1416 spends:
 *
 * ```text
 * (created_at ascending, event id ascending)
 * ```
 *
 * Event ids are compared as plain strings by code unit, which for canonical
 * lowercase-hex ids is numeric order of the hash. This is the same tie-break
 * NIP-01 defines for replaceable events (lowest id wins), applied to the
 * question "which of two concurrent spends gets the last unit".
 *
 * Every implementation walking the same set of spends in this order derives
 * the same applied / rejected result, whatever order relays delivered them in.
 * Nothing else — receipt time, relay, client, purpose — participates.
 *
 * Returns a negative number when `a` sorts first, positive when `b` does, and
 * `0` only for the same event id at the same `created_at`.
 */
export function compareGameInventorySpendOrder(
  a: GameInventorySpendOrderKey,
  b: GameInventorySpendOrderKey,
): number {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt < b.createdAt ? -1 : 1;
  }
  if (a.id === b.id) {
    return 0;
  }
  return a.id < b.id ? -1 : 1;
}

/**
 * Return a new array of `spends` in the deterministic order. The input is not
 * mutated.
 */
export function sortGameInventorySpends<T extends GameInventorySpendOrderKey>(
  spends: readonly T[],
): T[] {
  return [...spends].sort(compareGameInventorySpendOrder);
}
