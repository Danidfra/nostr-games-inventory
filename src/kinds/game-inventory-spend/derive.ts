import type { NostrEvent } from "../../nostr/event.js";
import { isBlank } from "../../common/strings.js";
import type { GameInventory } from "../game-inventory/types.js";
import { setInventoryItemQuantity } from "../game-inventory/helpers.js";
import {
  parseGameInventorySpendResult,
  type ParseGameInventorySpendOptions,
} from "./parse.js";
import { compareGameInventorySpendOrder } from "./order.js";
import type {
  DeriveGameInventoryStateInput,
  GameInventoryDerivedState,
  GameInventorySpend,
  GameInventorySpendApplication,
} from "./types.js";

export type DeriveGameInventoryStateOptions = Pick<
  ParseGameInventorySpendOptions,
  "requireHexPubkey" | "requireHexEventId"
>;

/**
 * Derive the effective state of an inventory from its snapshot and a set of
 * candidate spend events.
 *
 * ```text
 * effective quantity = snapshot quantity − applied pending spends
 * ```
 *
 * The algorithm, which every compliant implementation MUST reproduce:
 *
 * 1. deduplicate candidates by event id (relays deliver copies);
 * 2. discard events that are not structurally valid spends (`invalid`);
 * 3. discard valid spends against a different inventory address (`ignored`);
 * 4. set aside spends the fold chain has settled (`folded` / `voided`);
 * 5. sort the remaining pending spends by `(created_at, id)`;
 * 6. walk them in that order; a spend whose quantity is at most the current
 *    balance of its item is `applied` and decrements it, any other spend is
 *    `rejected` in full — never partially, never clamped, never deferred.
 *
 * Only the `applied` spends change any quantity. The result is a pure function
 * of `(snapshot, folded/voided ids, candidate set)` and does not depend on the
 * order candidates were supplied in.
 *
 * What this does NOT do: it does not fetch anything, so it cannot know
 * whether the candidate set is complete. A spend absent from `spends` is
 * simply not accounted; nothing here treats absence as proof of anything. And
 * it does not decide whether an item or issuer is trusted — that remains
 * application policy.
 */
export function deriveGameInventoryState(
  input: DeriveGameInventoryStateInput,
  options: DeriveGameInventoryStateOptions = {},
): GameInventoryDerivedState {
  const base = input.inventory;
  const foldedIds = new Set(input.foldedSpendIds ?? []);
  const voidedIds = new Set(input.voidedSpendIds ?? []);

  // 1. Deduplicate by event id, keeping the first copy. Events without an id
  //    cannot be deduplicated; they fail validation below anyway.
  const seen = new Set<string>();
  const duplicateSpendIds: string[] = [];
  const distinct: NostrEvent[] = [];
  for (const event of input.spends) {
    const id = event.id;
    if (typeof id === "string" && !isBlank(id)) {
      if (seen.has(id)) {
        if (!duplicateSpendIds.includes(id)) {
          duplicateSpendIds.push(id);
        }
        continue;
      }
      seen.add(id);
    }
    distinct.push(event);
  }

  // 2. Structural validity.
  const invalid: { event: NostrEvent; error: string }[] = [];
  const parsed: GameInventorySpend[] = [];
  for (const event of distinct) {
    const result = parseGameInventorySpendResult(event, options);
    if (result.ok) {
      parsed.push(result.value);
    } else {
      invalid.push({ event, error: result.error });
    }
  }

  // 3–5. Classify, in deterministic order.
  parsed.sort(compareGameInventorySpendOrder);

  const applications: GameInventorySpendApplication[] = [];
  const applied: GameInventorySpend[] = [];
  const rejected: GameInventorySpend[] = [];
  const folded: GameInventorySpend[] = [];
  const voided: GameInventorySpend[] = [];
  const ignored: GameInventorySpend[] = [];

  const balances = new Map<string, number>();
  for (const item of base.items) {
    balances.set(item.address, item.quantity);
  }
  const touched = new Set<string>();

  for (const spend of parsed) {
    if (spend.inventoryAddress !== base.address) {
      ignored.push(spend);
      applications.push({
        status: "ignored",
        spend,
        reason: "other-inventory",
      });
      continue;
    }
    if (foldedIds.has(spend.id)) {
      folded.push(spend);
      applications.push({ status: "folded", spend });
      continue;
    }
    if (voidedIds.has(spend.id)) {
      voided.push(spend);
      applications.push({ status: "voided", spend });
      continue;
    }

    // 6. Apply or reject; never partial, never clamped.
    const available = balances.get(spend.itemAddress) ?? 0;
    if (spend.quantity <= available) {
      const remaining = available - spend.quantity;
      balances.set(spend.itemAddress, remaining);
      touched.add(spend.itemAddress);
      applied.push(spend);
      applications.push({ status: "applied", spend, available, remaining });
    } else {
      rejected.push(spend);
      applications.push({
        status: "rejected",
        spend,
        reason: "insufficient-quantity",
        available,
        requested: spend.quantity,
      });
    }
  }

  // Invalid events last, in a deterministic order of their own.
  invalid.sort((a, b) =>
    compareGameInventorySpendOrder(
      { createdAt: a.event.created_at, id: a.event.id ?? "" },
      { createdAt: b.event.created_at, id: b.event.id ?? "" },
    ),
  );
  for (const entry of invalid) {
    applications.push({ status: "invalid", ...entry });
  }

  // Effective inventory: only touched items change; zero removes the item.
  let inventory: GameInventory = base;
  for (const address of touched) {
    inventory = setInventoryItemQuantity(
      inventory,
      address,
      balances.get(address) ?? 0,
    );
  }
  if (inventory === base) {
    // Always hand back a fresh object so callers can never mutate the base
    // through the derived state.
    inventory = { ...base, items: base.items.map((item) => ({ ...item })) };
  }

  return {
    base,
    inventory,
    applications,
    applied,
    rejected,
    folded,
    voided,
    ignored,
    invalid,
    duplicateSpendIds,
  };
}
