import { describe, it, expect } from "vitest";
import {
  deriveGameInventoryState,
  getInventoryItemQuantity,
  type NostrEvent,
} from "../src/index.js";
import { makeEvent } from "./helpers.js";
import {
  OWNER,
  ATTACKER,
  ISLAND,
  STRAWBERRY,
  CARROT,
  spendEvent,
  snapshot,
  quantityOf,
} from "./spend-fixtures.js";

function statuses(spends: NostrEvent[], items: Record<string, number>) {
  const state = deriveGameInventoryState({
    inventory: snapshot({ items }),
    spends,
  });
  return state.applications.map((a) =>
    a.status === "invalid"
      ? `${a.event.id ?? "?"}:invalid`
      : `${a.spend.id}:${a.status}`,
  );
}

describe("deriveGameInventoryState", () => {
  it("Example 1: a single pending spend decrements the snapshot", () => {
    const state = deriveGameInventoryState({
      inventory: snapshot({ items: { [STRAWBERRY]: 3 } }),
      spends: [spendEvent({ id: "s1" })],
    });
    expect(quantityOf(state.inventory, STRAWBERRY)).toBe(2);
    expect(quantityOf(state.base, STRAWBERRY)).toBe(3);
    expect(state.applied.map((s) => s.id)).toEqual(["s1"]);
    expect(state.applications).toEqual([
      {
        status: "applied",
        spend: state.applied[0],
        available: 3,
        remaining: 2,
      },
    ]);
  });

  it("never mutates the base and returns a fresh inventory even with no spends", () => {
    const base = snapshot({ items: { [STRAWBERRY]: 3 } });
    const before = JSON.stringify(base);
    const state = deriveGameInventoryState({ inventory: base, spends: [] });
    expect(state.inventory).not.toBe(base);
    expect(state.inventory.items).not.toBe(base.items);
    expect(state.inventory.items).toEqual(base.items);
    expect(JSON.stringify(base)).toBe(before);
  });

  it("handles multiple items and multiple spends", () => {
    const state = deriveGameInventoryState({
      inventory: snapshot({ items: { [STRAWBERRY]: 5, [CARROT]: 2 } }),
      spends: [
        spendEvent({ id: "s1", quantity: 2 }),
        spendEvent({ id: "s2", quantity: 2 }),
        spendEvent({ id: "c1", item: CARROT, quantity: 2 }),
      ],
    });
    expect(quantityOf(state.inventory, STRAWBERRY)).toBe(1);
    expect(getInventoryItemQuantity(state.inventory, CARROT)).toBe(0);
    // Reaching zero removes the item, as in every other 31633 helper.
    expect(state.inventory.items.map((i) => i.address)).toEqual([STRAWBERRY]);
    expect(state.applied.map((s) => s.id)).toEqual(["c1", "s1", "s2"]);
  });

  it("keeps item order of the snapshot for touched items", () => {
    const state = deriveGameInventoryState({
      inventory: snapshot({ items: { [STRAWBERRY]: 5, [CARROT]: 2 } }),
      spends: [spendEvent({ id: "s1", quantity: 1 })],
    });
    expect(state.inventory.items.map((i) => i.address)).toEqual([
      STRAWBERRY,
      CARROT,
    ]);
  });

  it("excludes folded ids and reports them as folded", () => {
    const state = deriveGameInventoryState({
      inventory: snapshot({ items: { [STRAWBERRY]: 1 } }),
      spends: [spendEvent({ id: "s1" }), spendEvent({ id: "s2" })],
      foldedSpendIds: ["s1"],
    });
    expect(quantityOf(state.inventory, STRAWBERRY)).toBe(0);
    expect(state.folded.map((s) => s.id)).toEqual(["s1"]);
    expect(state.applied.map((s) => s.id)).toEqual(["s2"]);
  });

  it("excludes voided ids and never re-applies them", () => {
    const state = deriveGameInventoryState({
      inventory: snapshot({ items: { [STRAWBERRY]: 9 } }),
      spends: [spendEvent({ id: "s1" })],
      voidedSpendIds: ["s1"],
    });
    expect(quantityOf(state.inventory, STRAWBERRY)).toBe(9);
    expect(state.voided.map((s) => s.id)).toEqual(["s1"]);
    expect(state.applied).toEqual([]);
  });

  it("deduplicates relay copies by event id", () => {
    const s1 = spendEvent({ id: "s1" });
    const state = deriveGameInventoryState({
      inventory: snapshot({ items: { [STRAWBERRY]: 3 } }),
      spends: [s1, { ...s1 }, s1],
    });
    expect(quantityOf(state.inventory, STRAWBERRY)).toBe(2);
    expect(state.duplicateSpendIds).toEqual(["s1"]);
    expect(state.applications).toHaveLength(1);
  });

  it("Example 5: concurrent overdraw of the last unit — first in order wins", () => {
    const inventory = snapshot({ items: { [STRAWBERRY]: 1 } });
    const s1 = spendEvent({ id: "bbb", createdAt: 100 });
    const s2 = spendEvent({ id: "aaa", createdAt: 100 });
    const forward = deriveGameInventoryState({ inventory, spends: [s1, s2] });
    const backward = deriveGameInventoryState({ inventory, spends: [s2, s1] });
    for (const state of [forward, backward]) {
      expect(state.applied.map((s) => s.id)).toEqual(["aaa"]);
      expect(state.rejected.map((s) => s.id)).toEqual(["bbb"]);
      expect(quantityOf(state.inventory, STRAWBERRY)).toBe(0);
    }
    expect(JSON.stringify(forward.applications)).toBe(
      JSON.stringify(backward.applications),
    );
  });

  it("an earlier created_at beats a lower id", () => {
    const inventory = snapshot({ items: { [STRAWBERRY]: 1 } });
    const state = deriveGameInventoryState({
      inventory,
      spends: [
        spendEvent({ id: "aaa", createdAt: 200 }),
        spendEvent({ id: "zzz", createdAt: 100 }),
      ],
    });
    expect(state.applied.map((s) => s.id)).toEqual(["zzz"]);
    expect(state.rejected.map((s) => s.id)).toEqual(["aaa"]);
  });

  it("rejects an overdraw in full: no partial application, no clamping", () => {
    const state = deriveGameInventoryState({
      inventory: snapshot({ items: { [STRAWBERRY]: 2 } }),
      spends: [spendEvent({ id: "s1", quantity: 3 })],
    });
    expect(quantityOf(state.inventory, STRAWBERRY)).toBe(2);
    expect(state.applications).toEqual([
      {
        status: "rejected",
        spend: state.rejected[0],
        reason: "insufficient-quantity",
        available: 2,
        requested: 3,
      },
    ]);
  });

  it("a rejected spend does not block a later smaller spend", () => {
    const state = deriveGameInventoryState({
      inventory: snapshot({ items: { [STRAWBERRY]: 2 } }),
      spends: [
        spendEvent({ id: "s1", createdAt: 1, quantity: 3 }),
        spendEvent({ id: "s2", createdAt: 2, quantity: 2 }),
      ],
    });
    expect(state.rejected.map((s) => s.id)).toEqual(["s1"]);
    expect(state.applied.map((s) => s.id)).toEqual(["s2"]);
    expect(quantityOf(state.inventory, STRAWBERRY)).toBe(0);
  });

  it("a spend of an item not in the snapshot is rejected against zero", () => {
    const state = deriveGameInventoryState({
      inventory: snapshot({ items: { [STRAWBERRY]: 2 } }),
      spends: [spendEvent({ id: "c1", item: CARROT })],
    });
    expect(state.rejected.map((s) => s.id)).toEqual(["c1"]);
    expect(state.applications[0]).toMatchObject({ available: 0, requested: 1 });
  });

  it("ignores valid spends against another inventory, including one by another owner", () => {
    const state = deriveGameInventoryState({
      inventory: snapshot({ items: { [STRAWBERRY]: 2 } }),
      spends: [
        spendEvent({ id: "i1", inventory: ISLAND }),
        spendEvent({
          id: "o1",
          inventory: "31633:someone:farm:main",
          pubkey: "someone",
        }),
      ],
    });
    expect(quantityOf(state.inventory, STRAWBERRY)).toBe(2);
    expect(state.ignored.map((s) => s.id)).toEqual(["i1", "o1"]);
    expect(state.applications.every((a) => a.status === "ignored")).toBe(true);
  });

  it("Example 6: a spend by another author is invalid and never debits", () => {
    const state = deriveGameInventoryState({
      inventory: snapshot({ items: { [STRAWBERRY]: 2 } }),
      spends: [spendEvent({ id: "x1", pubkey: ATTACKER })],
    });
    expect(quantityOf(state.inventory, STRAWBERRY)).toBe(2);
    expect(state.invalid).toHaveLength(1);
    expect(state.invalid[0]?.error).toContain("not the inventory owner");
  });

  it("reports malformed events as invalid, ordered last", () => {
    const junk = makeEvent({ kind: 1, id: "junk", pubkey: OWNER });
    const state = deriveGameInventoryState({
      inventory: snapshot({ items: { [STRAWBERRY]: 2 } }),
      spends: [junk, spendEvent({ id: "s1" })],
    });
    expect(state.applications.map((a) => a.status)).toEqual([
      "applied",
      "invalid",
    ]);
    expect(quantityOf(state.inventory, STRAWBERRY)).toBe(1);
  });

  it("produces byte-identical results regardless of input order", () => {
    const events = [
      spendEvent({ id: "s3", createdAt: 3, quantity: 2 }),
      spendEvent({ id: "s1", createdAt: 1 }),
      spendEvent({ id: "s2", createdAt: 1, quantity: 3 }),
      spendEvent({ id: "i1", inventory: ISLAND }),
      spendEvent({ id: "x1", pubkey: ATTACKER }),
      makeEvent({ kind: 1, id: "junk" }),
    ];
    const items = { [STRAWBERRY]: 4 };
    const expected = statuses(events, items);
    expect(expected).toEqual([
      "s1:applied",
      "s2:applied",
      "s3:rejected",
      "i1:ignored",
      "junk:invalid",
      "x1:invalid",
    ]);
    for (let i = 0; i < 10; i += 1) {
      const shuffled = [...events].sort(() => (i % 2 === 0 ? 1 : -1));
      expect(statuses(shuffled, items)).toEqual(expected);
    }
  });

  it("folded status takes precedence over the balance walk", () => {
    // s1 is folded: the snapshot already reflects it, so s2 gets the unit.
    const state = deriveGameInventoryState({
      inventory: snapshot({ items: { [STRAWBERRY]: 1 } }),
      spends: [
        spendEvent({ id: "s1", createdAt: 1 }),
        spendEvent({ id: "s2", createdAt: 2 }),
      ],
      foldedSpendIds: new Set(["s1"]),
    });
    expect(state.applied.map((s) => s.id)).toEqual(["s2"]);
    expect(quantityOf(state.inventory, STRAWBERRY)).toBe(0);
  });
});
