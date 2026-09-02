import type { GameInventory, GameInventoryItem } from "./types.js";
import {
  assertNonNegativeInteger,
  addQuantitiesChecked,
} from "./quantity.internal.js";
import { parseGameItemAddress } from "../game-item-definition/address.js";
import { KIND_GAME_ITEM_DEFINITION } from "../../common/constants.js";

/**
 * Assert that `itemAddress` is a well-formed kind:31632 coordinate.
 *
 * @throws {Error} when the address is malformed or references another kind.
 */
function assertItemAddress(itemAddress: string): void {
  if (parseGameItemAddress(itemAddress) === null) {
    throw new Error(
      `itemAddress must be a valid kind:${KIND_GAME_ITEM_DEFINITION} coordinate, got: ${String(itemAddress)}`,
    );
  }
}

/**
 * Read the quantity of an item in an inventory.
 *
 * Returns `0` when the item is not present. This mirrors inventory semantics:
 * a missing item is equivalent to holding zero of it.
 */
export function getInventoryItemQuantity(
  inventory: GameInventory,
  itemAddress: string,
): number {
  for (const item of inventory.items) {
    if (item.address === itemAddress) {
      return item.quantity;
    }
  }
  return 0;
}

/**
 * Return a new inventory with the given item's quantity set to an exact value.
 *
 * - `itemAddress` must be a valid kind:31632 coordinate (throws otherwise).
 * - `quantity` must be a non-negative safe integer (throws otherwise); it is
 *   never floored, clamped, or silently dropped.
 * - Setting a quantity of `0` removes the item.
 * - The input inventory is never mutated (pure / immutable). When the
 *   operation is rejected it throws before producing any value, so the input
 *   is untouched.
 */
export function setInventoryItemQuantity(
  inventory: GameInventory,
  itemAddress: string,
  quantity: number,
  relay?: string,
): GameInventory {
  assertItemAddress(itemAddress);
  assertNonNegativeInteger(quantity, "quantity");

  const existing = inventory.items.find((item) => item.address === itemAddress);

  if (quantity === 0) {
    // Remove the item (if present). Always return a fresh object.
    return {
      ...inventory,
      items: inventory.items
        .filter((item) => item.address !== itemAddress)
        .map((item) => ({ ...item })),
    };
  }

  const resolvedRelay = relay ?? existing?.relay ?? "";

  if (existing) {
    // Preserve original position.
    return {
      ...inventory,
      items: inventory.items.map((item) =>
        item.address === itemAddress
          ? { address: itemAddress, relay: resolvedRelay, quantity }
          : { ...item },
      ),
    };
  }

  return {
    ...inventory,
    items: [
      ...inventory.items.map((item) => ({ ...item })),
      { address: itemAddress, relay: resolvedRelay, quantity },
    ],
  };
}

/**
 * Return a new inventory with `amount` added to the item's quantity.
 *
 * - `itemAddress` must be a valid kind:31632 coordinate (throws otherwise).
 * - `amount` must be a non-negative safe integer (throws otherwise). An amount
 *   of `0` is a no-op that still returns a fresh inventory object.
 * - Throws if the resulting quantity would exceed Number.MAX_SAFE_INTEGER.
 * - The input inventory is never mutated.
 */
export function addInventoryItemQuantity(
  inventory: GameInventory,
  itemAddress: string,
  amount: number,
  relay?: string,
): GameInventory {
  assertItemAddress(itemAddress);
  assertNonNegativeInteger(amount, "amount");

  const current = getInventoryItemQuantity(inventory, itemAddress);
  const next = addQuantitiesChecked(current, amount, "quantity");
  return setInventoryItemQuantity(inventory, itemAddress, next, relay);
}

/**
 * Return a new inventory with `amount` removed from the item's quantity.
 *
 * - `itemAddress` must be a valid kind:31632 coordinate (throws otherwise).
 * - `amount` must be a non-negative safe integer (throws otherwise).
 * - The result is clamped at zero; reaching zero removes the item. (Clamping a
 *   removal *result* to zero is allowed; the requested `amount` itself must be
 *   valid and is never silently corrected.)
 * - The input inventory is never mutated.
 */
export function removeInventoryItemQuantity(
  inventory: GameInventory,
  itemAddress: string,
  amount: number,
): GameInventory {
  assertItemAddress(itemAddress);
  assertNonNegativeInteger(amount, "amount");

  const current = getInventoryItemQuantity(inventory, itemAddress);
  const next = Math.max(0, current - amount);
  return setInventoryItemQuantity(inventory, itemAddress, next);
}

/**
 * Return a shallow copy of the inventory's items array.
 *
 * Useful for callers that want the item list without exposing the internal
 * reference.
 */
export function getInventoryItems(
  inventory: GameInventory,
): GameInventoryItem[] {
  return inventory.items.map((item) => ({ ...item }));
}

/**
 * The outcome of a checked removal.
 *
 * Insufficient quantity is a *data* condition, not a programming error, so it
 * is reported as a structured result rather than thrown — the same division the
 * rest of the package uses (a malformed address or a non-integer amount still
 * throws, because those are caller bugs).
 */
export type GameInventoryRemovalResult =
  | {
      ok: true;
      /** The new inventory. The input is never mutated. */
      inventory: GameInventory;
      /** Units actually removed. Equal to the requested amount. */
      removed: number;
      /** Units left after the removal. `0` means the item was removed. */
      remaining: number;
    }
  | {
      ok: false;
      reason: "insufficient-quantity";
      /** Units the inventory actually held. */
      available: number;
      /** Units the caller asked to remove. */
      requested: number;
    };

/**
 * Remove `amount` of an item, reporting insufficient quantity instead of
 * silently clamping.
 *
 * {@link removeInventoryItemQuantity} clamps its *result* at zero, so removing
 * 5 units of an item the player holds 2 of succeeds and reports nothing. That
 * is the correct behaviour for a caller that means "take up to N", and it is
 * kept unchanged. It is the wrong behaviour for a spend: an over-spend then
 * looks identical to a legitimate one.
 *
 * This variant refuses instead, and tells the caller what was actually
 * available.
 *
 * - `itemAddress` must be a valid kind:31632 coordinate (throws otherwise).
 * - `amount` must be a non-negative safe integer (throws otherwise). Removing
 *   `0` always succeeds and returns a fresh inventory object.
 * - The input inventory is never mutated, and on `ok: false` nothing is built.
 */
export function removeInventoryItemQuantityChecked(
  inventory: GameInventory,
  itemAddress: string,
  amount: number,
): GameInventoryRemovalResult {
  assertItemAddress(itemAddress);
  assertNonNegativeInteger(amount, "amount");

  const available = getInventoryItemQuantity(inventory, itemAddress);
  if (amount > available) {
    return {
      ok: false,
      reason: "insufficient-quantity",
      available,
      requested: amount,
    };
  }

  const remaining = available - amount;
  return {
    ok: true,
    inventory: setInventoryItemQuantity(inventory, itemAddress, remaining),
    removed: amount,
    remaining,
  };
}
