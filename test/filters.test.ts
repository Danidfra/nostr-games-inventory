import { describe, it, expect } from "vitest";
import {
  buildGameInventoryFilter,
  buildGameItemDefinitionFilter,
  removeInventoryItemQuantityChecked,
  removeInventoryItemQuantity,
  parseGameInventory,
  KIND_GAME_INVENTORY,
  KIND_GAME_ITEM_DEFINITION,
  type GameInventory,
} from "../src/index.js";
import { makeEvent } from "./helpers.js";

const CARROT = "31632:pubkey123:blobbi:food:carrot";
const OWNER = "a".repeat(64);

describe("buildGameInventoryFilter", () => {
  it("returns a kind-only filter with no options", () => {
    expect(buildGameInventoryFilter()).toEqual({
      kinds: [KIND_GAME_INVENTORY],
    });
  });

  it("discovers every inventory an owner has, with no d values known", () => {
    expect(buildGameInventoryFilter({ authors: [OWNER] })).toEqual({
      kinds: [KIND_GAME_INVENTORY],
      authors: [OWNER],
    });
  });

  it("narrows to one inventory context when asked", () => {
    expect(
      buildGameInventoryFilter({
        authors: [OWNER],
        inventoryIds: ["farm:main"],
      }),
    ).toEqual({
      kinds: [KIND_GAME_INVENTORY],
      authors: [OWNER],
      "#d": ["farm:main"],
    });
  });

  it("supports finding inventories that reference an item", () => {
    expect(buildGameInventoryFilter({ addresses: [CARROT] })).toEqual({
      kinds: [KIND_GAME_INVENTORY],
      "#a": [CARROT],
    });
  });

  it("drops blanks and duplicates, keeping first-seen order", () => {
    expect(
      buildGameInventoryFilter({
        authors: [OWNER, "", "  ", OWNER, "b"],
        inventoryIds: ["farm:main", "farm:main"],
      }),
    ).toEqual({
      kinds: [KIND_GAME_INVENTORY],
      authors: [OWNER, "b"],
      "#d": ["farm:main"],
    });
  });

  it("omits a field entirely when it resolves to no values", () => {
    const filter = buildGameInventoryFilter({
      authors: [""],
      inventoryIds: [],
    });
    expect(filter).toEqual({ kinds: [KIND_GAME_INVENTORY] });
    expect("authors" in filter).toBe(false);
    expect("#d" in filter).toBe(false);
  });

  it("is deterministic", () => {
    const options = { authors: [OWNER], inventoryIds: ["a", "b"] };
    expect(buildGameInventoryFilter(options)).toEqual(
      buildGameInventoryFilter(options),
    );
  });
});

describe("buildGameItemDefinitionFilter", () => {
  it("returns a kind-only filter with no options", () => {
    expect(buildGameItemDefinitionFilter()).toEqual({
      kinds: [KIND_GAME_ITEM_DEFINITION],
    });
  });

  it("resolves one issuer's item ids", () => {
    expect(
      buildGameItemDefinitionFilter({
        authors: ["issuer"],
        itemIds: ["farm:food:strawberry"],
      }),
    ).toEqual({
      kinds: [KIND_GAME_ITEM_DEFINITION],
      authors: ["issuer"],
      "#d": ["farm:food:strawberry"],
    });
  });

  it("supports issuer-independent topic discovery", () => {
    expect(buildGameItemDefinitionFilter({ topics: ["edible"] })).toEqual({
      kinds: [KIND_GAME_ITEM_DEFINITION],
      "#t": ["edible"],
    });
  });

  it("drops blanks and duplicates", () => {
    expect(
      buildGameItemDefinitionFilter({
        topics: ["edible", "", "edible", "fruit"],
      }),
    ).toEqual({
      kinds: [KIND_GAME_ITEM_DEFINITION],
      "#t": ["edible", "fruit"],
    });
  });

  it("is deterministic", () => {
    const options = { authors: ["issuer"], topics: ["edible"] };
    expect(buildGameItemDefinitionFilter(options)).toEqual(
      buildGameItemDefinitionFilter(options),
    );
  });
});

describe("removeInventoryItemQuantityChecked", () => {
  const inventory = parseGameInventory(
    makeEvent({
      kind: KIND_GAME_INVENTORY,
      pubkey: "owner",
      tags: [
        ["d", "farm:main"],
        ["a", CARROT, "", "2"],
      ],
    }),
  ) as GameInventory;

  it("removes when the quantity is available", () => {
    const result = removeInventoryItemQuantityChecked(inventory, CARROT, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.removed).toBe(1);
    expect(result.remaining).toBe(1);
    expect(result.inventory.items).toEqual([
      { address: CARROT, relay: "", quantity: 1 },
    ]);
  });

  it("removes the entry when the removal empties it", () => {
    const result = removeInventoryItemQuantityChecked(inventory, CARROT, 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.remaining).toBe(0);
    expect(result.inventory.items).toEqual([]);
  });

  it("refuses an over-spend instead of clamping", () => {
    const result = removeInventoryItemQuantityChecked(inventory, CARROT, 5);
    expect(result).toEqual({
      ok: false,
      reason: "insufficient-quantity",
      available: 2,
      requested: 5,
    });
  });

  it("refuses when the item is absent entirely", () => {
    const result = removeInventoryItemQuantityChecked(
      inventory,
      "31632:pubkey123:blobbi:food:apple",
      1,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.available).toBe(0);
  });

  it("succeeds on a zero removal", () => {
    const result = removeInventoryItemQuantityChecked(inventory, CARROT, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.inventory.items).toEqual(inventory.items);
  });

  it("still throws for caller bugs, not data conditions", () => {
    expect(() =>
      removeInventoryItemQuantityChecked(inventory, "not-an-address", 1),
    ).toThrow();
    expect(() =>
      removeInventoryItemQuantityChecked(inventory, CARROT, -1),
    ).toThrow();
    expect(() =>
      removeInventoryItemQuantityChecked(inventory, CARROT, 1.5),
    ).toThrow();
  });

  it("never mutates the input inventory", () => {
    const before = JSON.stringify(inventory.items);
    removeInventoryItemQuantityChecked(inventory, CARROT, 2);
    expect(JSON.stringify(inventory.items)).toBe(before);
  });

  it("leaves the clamping behaviour of the original helper unchanged", () => {
    // Backward compatibility: the pre-existing helper must still clamp.
    const clamped = removeInventoryItemQuantity(inventory, CARROT, 99);
    expect(clamped.items).toEqual([]);
  });
});
