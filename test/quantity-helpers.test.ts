import { describe, it, expect } from "vitest";
import {
  parseInventoryQuantity,
  getInventoryItemQuantity,
  setInventoryItemQuantity,
  addInventoryItemQuantity,
  removeInventoryItemQuantity,
  parseGameInventory,
  type GameInventory,
} from "../src/index.js";
import { makeEvent } from "./helpers.js";

const CARROT = "31632:pubkey123:blobbi:food:carrot";
const HAT = "31632:pubkey123:blobbi:cosmetic:wizard_hat";

function inventoryWith(
  items: { address: string; relay?: string; quantity: number }[],
): GameInventory {
  const tags: string[][] = [["d", "game:blobbi"]];
  for (const it of items) {
    tags.push(["a", it.address, it.relay ?? "", String(it.quantity)]);
  }
  const inv = parseGameInventory(
    makeEvent({ kind: 31633, pubkey: "owner", tags }),
  );
  if (inv === null) throw new Error("fixture inventory failed to parse");
  return inv;
}

describe("parseInventoryQuantity", () => {
  it("accepts positive decimal integers", () => {
    expect(parseInventoryQuantity("1")).toBe(1);
    expect(parseInventoryQuantity("99")).toBe(99);
    expect(parseInventoryQuantity("1000")).toBe(1000);
  });

  it("rejects zero, negatives, decimals, and non-numeric", () => {
    expect(parseInventoryQuantity("0")).toBeNull();
    expect(parseInventoryQuantity("-1")).toBeNull();
    expect(parseInventoryQuantity("1.5")).toBeNull();
    expect(parseInventoryQuantity("abc")).toBeNull();
    expect(parseInventoryQuantity("1e3")).toBeNull();
    expect(parseInventoryQuantity("0x1")).toBeNull();
    expect(parseInventoryQuantity(" 1 ")).toBeNull();
    expect(parseInventoryQuantity("+1")).toBeNull();
    expect(parseInventoryQuantity("03")).toBeNull();
  });

  it("rejects missing values", () => {
    expect(parseInventoryQuantity(undefined)).toBeNull();
    expect(parseInventoryQuantity(null)).toBeNull();
  });
});

describe("quantity helpers", () => {
  it("reads a missing item quantity as 0", () => {
    const inv = inventoryWith([]);
    expect(getInventoryItemQuantity(inv, CARROT)).toBe(0);
  });

  it("adds quantity, creating the item", () => {
    const inv = inventoryWith([]);
    const next = addInventoryItemQuantity(inv, CARROT, 3);
    expect(getInventoryItemQuantity(next, CARROT)).toBe(3);
  });

  it("adds quantity to an existing item", () => {
    const inv = inventoryWith([{ address: CARROT, quantity: 2 }]);
    const next = addInventoryItemQuantity(inv, CARROT, 3);
    expect(getInventoryItemQuantity(next, CARROT)).toBe(5);
  });

  it("removes quantity", () => {
    const inv = inventoryWith([{ address: CARROT, quantity: 5 }]);
    const next = removeInventoryItemQuantity(inv, CARROT, 2);
    expect(getInventoryItemQuantity(next, CARROT)).toBe(3);
  });

  it("removes down to zero and drops the item", () => {
    const inv = inventoryWith([{ address: CARROT, quantity: 3 }]);
    const next = removeInventoryItemQuantity(inv, CARROT, 3);
    expect(getInventoryItemQuantity(next, CARROT)).toBe(0);
    expect(next.items.some((i) => i.address === CARROT)).toBe(false);
  });

  it("never produces a negative result", () => {
    const inv = inventoryWith([{ address: CARROT, quantity: 2 }]);
    const next = removeInventoryItemQuantity(inv, CARROT, 10);
    expect(getInventoryItemQuantity(next, CARROT)).toBe(0);
  });

  it("sets an exact quantity", () => {
    const inv = inventoryWith([{ address: CARROT, quantity: 2 }]);
    const next = setInventoryItemQuantity(inv, CARROT, 7);
    expect(getInventoryItemQuantity(next, CARROT)).toBe(7);
  });

  it("setting to zero removes the item", () => {
    const inv = inventoryWith([{ address: CARROT, quantity: 2 }]);
    const next = setInventoryItemQuantity(inv, CARROT, 0);
    expect(next.items.some((i) => i.address === CARROT)).toBe(false);
  });

  it("preserves item order when updating an existing item", () => {
    const inv = inventoryWith([
      { address: CARROT, quantity: 2 },
      { address: HAT, quantity: 1 },
    ]);
    const next = setInventoryItemQuantity(inv, CARROT, 9);
    expect(next.items.map((i) => i.address)).toEqual([CARROT, HAT]);
  });

  it("is immutable: input inventory is never mutated", () => {
    const inv = inventoryWith([{ address: CARROT, quantity: 2 }]);
    const snapshot = JSON.stringify(inv.items);
    addInventoryItemQuantity(inv, CARROT, 5);
    removeInventoryItemQuantity(inv, CARROT, 1);
    setInventoryItemQuantity(inv, HAT, 4);
    expect(JSON.stringify(inv.items)).toBe(snapshot);
  });
});

describe("helper input validation", () => {
  const INVALID_ADDR = "not-an-address";
  const WRONG_KIND = "31633:pk:other:inv";

  it("rejects a malformed itemAddress in all helpers", () => {
    const inv = inventoryWith([]);
    expect(() => setInventoryItemQuantity(inv, INVALID_ADDR, 1)).toThrow();
    expect(() => addInventoryItemQuantity(inv, INVALID_ADDR, 1)).toThrow();
    expect(() => removeInventoryItemQuantity(inv, INVALID_ADDR, 1)).toThrow();
  });

  it("rejects an itemAddress referencing the wrong kind", () => {
    const inv = inventoryWith([]);
    expect(() => setInventoryItemQuantity(inv, WRONG_KIND, 1)).toThrow();
    expect(() => addInventoryItemQuantity(inv, WRONG_KIND, 1)).toThrow();
    expect(() => removeInventoryItemQuantity(inv, WRONG_KIND, 1)).toThrow();
  });

  it("rejects invalid quantities/amounts in all helpers", () => {
    const inv = inventoryWith([{ address: CARROT, quantity: 5 }]);
    const invalid = [
      -1,
      1.5,
      NaN,
      Infinity,
      -Infinity,
      Number.MAX_SAFE_INTEGER + 1,
    ];
    for (const value of invalid) {
      expect(() => setInventoryItemQuantity(inv, CARROT, value)).toThrow();
      expect(() => addInventoryItemQuantity(inv, CARROT, value)).toThrow();
      expect(() => removeInventoryItemQuantity(inv, CARROT, value)).toThrow();
    }
  });

  it("accepts amount 0 as a no-op that returns a fresh object", () => {
    const inv = inventoryWith([{ address: CARROT, quantity: 5 }]);
    const next = addInventoryItemQuantity(inv, CARROT, 0);
    expect(next).not.toBe(inv);
    expect(getInventoryItemQuantity(next, CARROT)).toBe(5);
  });

  it("throws on add overflow beyond MAX_SAFE_INTEGER", () => {
    const inv = inventoryWith([
      { address: CARROT, quantity: Number.MAX_SAFE_INTEGER },
    ]);
    expect(() => addInventoryItemQuantity(inv, CARROT, 1)).toThrow();
  });

  it("does not mutate the input when a helper operation is rejected", () => {
    const inv = inventoryWith([{ address: CARROT, quantity: 5 }]);
    const snapshot = JSON.stringify(inv.items);
    expect(() => setInventoryItemQuantity(inv, CARROT, -1)).toThrow();
    expect(() => addInventoryItemQuantity(inv, "bad-address", 1)).toThrow();
    expect(() =>
      addInventoryItemQuantity(inv, CARROT, Number.MAX_SAFE_INTEGER),
    ).toThrow();
    expect(JSON.stringify(inv.items)).toBe(snapshot);
  });

  it("does not mutate the input on a successful operation", () => {
    const inv = inventoryWith([{ address: CARROT, quantity: 5 }]);
    const snapshot = JSON.stringify(inv.items);
    const next = setInventoryItemQuantity(inv, CARROT, 9);
    expect(next).not.toBe(inv);
    expect(next.items).not.toBe(inv.items);
    expect(JSON.stringify(inv.items)).toBe(snapshot);
  });
});
