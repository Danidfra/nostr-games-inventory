import { describe, it, expect } from "vitest";
import {
  addPlacement,
  buildGameItemPlacementFilter,
  compareGameItemPlacementRevisions,
  filterEventsByPlacementItemAddress,
  getFirstEquippedPlacementBySlot,
  getLastEquippedPlacementBySlot,
  getPlacementById,
  getPlacementItems,
  getPlacementItemTags,
  getPlacementTargetTags,
  getPlacementsByItem,
  getPlacementsBySlot,
  isAddressPlacementTarget,
  isGameItemPlacement2DReference,
  isGameItemPlacement3DReference,
  isGameItemPlacementEulerRotation,
  isGameItemPlacementMode,
  isGameItemPlacementQuaternionRotation,
  isInternalPlacementTarget,
  isPlacementItemTag,
  isPlacementTargetTag,
  parseGameItemPlacement,
  removeEquippedPlacementFromSlot,
  removePlacement,
  replacePlacement,
  setEquippedPlacementForSlot,
  KIND_GAME_ITEM_PLACEMENT,
  type GameItemPlacement,
  type GameItemPlacementEntry,
} from "../src/index.js";
import { makeEvent } from "./helpers.js";

const HAT = "31632:pubkey123:blobbi:cosmetic:wizard_hat";
const SCARF = "31632:pubkey123:blobbi:cosmetic:scarf";
const CARROT = "31632:pubkey123:blobbi:food:carrot";
const CHARACTER = "31124:owner123:blobbi:char-1";

function makePlacement(
  placements: unknown[],
  extraContent: Record<string, unknown> = {},
): GameItemPlacement {
  const event = makeEvent({
    kind: KIND_GAME_ITEM_PLACEMENT,
    pubkey: "author1",
    tags: [
      ["d", "p"],
      ["target", "room"],
    ],
    content: JSON.stringify({
      target: { type: "internal", id: "room" },
      placements,
      ...extraContent,
    }),
  });
  const placement = parseGameItemPlacement(event);
  if (placement === null) {
    throw new Error("fixture failed to parse");
  }
  return placement;
}

const equipHat: GameItemPlacementEntry = {
  id: "head",
  item: HAT,
  mode: "equip",
  slot: "head",
};
const equipScarf: GameItemPlacementEntry = {
  id: "neck",
  item: SCARF,
  mode: "equip",
  slot: "neck",
};
const placedCarrot: GameItemPlacementEntry = {
  id: "snack",
  item: CARROT,
  mode: "place",
  slot: "head",
};

describe("placement query helpers", () => {
  const placement = makePlacement([equipHat, equipScarf, placedCarrot]);

  it("returns unique item addresses in first-placement order", () => {
    expect(getPlacementItems(placement)).toEqual([HAT, SCARF, CARROT]);
  });

  it("returns a copy of the item addresses", () => {
    const items = getPlacementItems(placement);
    items.push("mutated");
    expect(placement.itemAddresses).toHaveLength(3);
  });

  it("gets an entry by id", () => {
    expect(getPlacementById(placement, "neck")?.item).toBe(SCARF);
    expect(getPlacementById(placement, "missing")).toBeUndefined();
  });

  it("gets placements by item", () => {
    const multi = makePlacement([
      equipHat,
      { id: "second-hat", item: HAT, mode: "place" },
      equipScarf,
    ]);
    expect(getPlacementsByItem(multi, HAT).map((e) => e.id)).toEqual([
      "head",
      "second-hat",
    ]);
    expect(getPlacementsByItem(multi, "31632:x:none")).toEqual([]);
  });

  it("gets every placement using a slot, regardless of mode", () => {
    expect(getPlacementsBySlot(placement, "head").map((e) => e.id)).toEqual([
      "head",
      "snack",
    ]);
  });

  it("distinguishes first and last equipped placement in a slot", () => {
    const duplicated = makePlacement([
      equipHat,
      placedCarrot,
      { id: "head-2", item: SCARF, mode: "equip", slot: "head" },
    ]);
    expect(getFirstEquippedPlacementBySlot(duplicated, "head")?.id).toBe(
      "head",
    );
    expect(getLastEquippedPlacementBySlot(duplicated, "head")?.id).toBe(
      "head-2",
    );
    expect(getFirstEquippedPlacementBySlot(duplicated, "toes")).toBeUndefined();
    expect(getLastEquippedPlacementBySlot(duplicated, "toes")).toBeUndefined();
  });

  it("returns copies that cannot mutate the source", () => {
    const nested = makePlacement([
      { ...equipHat, metadata: { deep: { value: 1 } } },
    ]);
    const entry = getPlacementById(nested, "head");
    (entry?.metadata as { deep: { value: number } }).deep.value = 99;
    expect(
      (nested.placements[0]?.metadata as { deep: { value: number } }).deep
        .value,
    ).toBe(1);
  });
});

describe("placement mutation helpers", () => {
  it("adds an entry and recomputes derived item addresses", () => {
    const placement = makePlacement([equipHat]);
    const next = addPlacement(placement, equipScarf);
    expect(next.placements.map((e) => e.id)).toEqual(["head", "neck"]);
    expect(next.itemAddresses).toEqual([HAT, SCARF]);
    // The input is untouched.
    expect(placement.placements).toHaveLength(1);
    expect(placement.itemAddresses).toEqual([HAT]);
  });

  it("refuses to add a duplicate id", () => {
    const placement = makePlacement([equipHat]);
    expect(() => addPlacement(placement, { ...equipHat, item: SCARF })).toThrow(
      /already exists/,
    );
  });

  it("validates the entry it is given", () => {
    const placement = makePlacement([]);
    expect(() =>
      addPlacement(placement, {
        id: "x",
        item: "not-an-address",
        mode: "equip",
      }),
    ).toThrow(/item/);
    expect(() =>
      addPlacement(placement, { id: "", item: HAT, mode: "equip" }),
    ).toThrow(/id/);
  });

  it("replaces an entry in place", () => {
    const placement = makePlacement([equipHat, equipScarf]);
    const next = replacePlacement(placement, {
      ...equipHat,
      item: CARROT,
      layer: 2,
    });
    expect(next.placements.map((e) => e.id)).toEqual(["head", "neck"]);
    expect(next.placements[0]?.item).toBe(CARROT);
    expect(next.placements[0]?.layer).toBe(2);
    expect(next.itemAddresses).toEqual([CARROT, SCARF]);
    expect(placement.placements[0]?.item).toBe(HAT);
  });

  it("replaces only the first of a duplicated id", () => {
    const placement = makePlacement([
      equipHat,
      { ...equipHat, item: SCARF, slot: "head-2" },
    ]);
    const next = replacePlacement(placement, { ...equipHat, item: CARROT });
    expect(next.placements.map((e) => e.item)).toEqual([CARROT, SCARF]);
  });

  it("throws when replacing an id that does not exist", () => {
    const placement = makePlacement([equipHat]);
    expect(() => replacePlacement(placement, equipScarf)).toThrow(
      /no placement/,
    );
  });

  it("removes every entry with an id", () => {
    const placement = makePlacement([
      equipHat,
      equipScarf,
      { ...equipHat, item: CARROT, slot: "head-2" },
    ]);
    const next = removePlacement(placement, "head");
    expect(next.placements.map((e) => e.id)).toEqual(["neck"]);
    expect(next.itemAddresses).toEqual([SCARF]);
  });

  it("removing an unknown id is a no-op that still returns a new object", () => {
    const placement = makePlacement([equipHat]);
    const next = removePlacement(placement, "nope");
    expect(next).not.toBe(placement);
    expect(next.placements).toHaveLength(1);
  });

  it("sets an equipped placement for an empty slot by appending", () => {
    const placement = makePlacement([equipHat]);
    const next = setEquippedPlacementForSlot(placement, "neck", equipScarf);
    expect(next.placements.map((e) => e.id)).toEqual(["head", "neck"]);
  });

  it("replaces a slot deterministically, keeping the original position", () => {
    const placement = makePlacement([equipHat, equipScarf, placedCarrot]);
    const next = setEquippedPlacementForSlot(placement, "head", {
      id: "head",
      item: CARROT,
      mode: "equip",
      slot: "head",
    });
    expect(next.placements.map((e) => e.id)).toEqual(["head", "neck", "snack"]);
    expect(next.placements[0]?.item).toBe(CARROT);
    // The non-equip entry that shares the slot is preserved.
    expect(next.placements[2]?.mode).toBe("place");
  });

  it("collapses duplicate equipped entries for the slot into one", () => {
    const placement = makePlacement([
      equipHat,
      equipScarf,
      { id: "head-2", item: SCARF, mode: "equip", slot: "head" },
    ]);
    const next = setEquippedPlacementForSlot(placement, "head", {
      id: "head",
      item: CARROT,
      mode: "equip",
      slot: "head",
    });
    expect(
      next.placements.filter((e) => e.mode === "equip" && e.slot === "head"),
    ).toHaveLength(1);
    expect(next.placements.map((e) => e.id)).toEqual(["head", "neck"]);
  });

  it("fills in an omitted slot but rejects a contradicting one", () => {
    const placement = makePlacement([]);
    const next = setEquippedPlacementForSlot(placement, "head", {
      id: "head",
      item: HAT,
      mode: "equip",
    });
    expect(next.placements[0]?.slot).toBe("head");

    expect(() =>
      setEquippedPlacementForSlot(placement, "head", {
        id: "x",
        item: HAT,
        mode: "equip",
        slot: "neck",
      }),
    ).toThrow(/does not match/);
  });

  it("rejects a non-equip entry and a blank slot", () => {
    const placement = makePlacement([]);
    expect(() =>
      setEquippedPlacementForSlot(placement, "head", {
        id: "x",
        item: HAT,
        mode: "place",
        slot: "head",
      }),
    ).toThrow(/"equip"/);
    expect(() =>
      setEquippedPlacementForSlot(placement, "  ", equipHat),
    ).toThrow(/slot/);
  });

  it("removes equipped placements from a slot, preserving other modes", () => {
    const placement = makePlacement([equipHat, equipScarf, placedCarrot]);
    const next = removeEquippedPlacementFromSlot(placement, "head");
    expect(next.placements.map((e) => e.id)).toEqual(["neck", "snack"]);
    expect(next.itemAddresses).toEqual([SCARF, CARROT]);
  });

  it("preserves unknown entry fields and top-level content through mutation", () => {
    const placement = makePlacement(
      [{ ...equipHat, futureField: "keep" }, equipScarf],
      { futureTopLevel: 42, version: 1, revision: 3 },
    );
    const next = removePlacement(placement, "neck");
    expect(next.placements[0]?.["futureField"]).toBe("keep");
    expect(next.contentJson["futureTopLevel"]).toBe(42);
    expect(next.version).toBe(1);
    expect(next.revision).toBe(3);
    expect(next.target).toEqual({ type: "internal", id: "room" });
  });

  it("never mutates nested source objects", () => {
    const placement = makePlacement([
      { ...equipHat, metadata: { deep: { value: 1 } } },
      equipScarf,
    ]);
    const snapshot = JSON.stringify(placement.placements);
    const next = removePlacement(placement, "neck");
    (next.placements[0]?.metadata as { deep: { value: number } }).deep.value =
      99;
    expect(JSON.stringify(placement.placements)).toBe(snapshot);
  });

  it("keeps source-event fields untouched so a rebuild regenerates them", () => {
    const placement = makePlacement([equipHat]);
    const next = removePlacement(placement, "head");
    expect(next.event).toBe(placement.event);
    expect(next.content).toBe(placement.content);
    expect(next.itemTags).toEqual(placement.itemTags);
  });
});

describe("compareGameItemPlacementRevisions", () => {
  const base = { content: '{"a":1}', event: { id: "id-1" } };

  it("is unknown when either revision is missing", () => {
    expect(compareGameItemPlacementRevisions({}, { revision: 1 })).toBe(
      "unknown",
    );
    expect(compareGameItemPlacementRevisions({ revision: 1 }, {})).toBe(
      "unknown",
    );
    expect(compareGameItemPlacementRevisions({}, {})).toBe("unknown");
  });

  it("is unknown for invalid revisions", () => {
    const invalid = [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY];
    for (const revision of invalid) {
      expect(
        compareGameItemPlacementRevisions({ revision: 1 }, { revision }),
      ).toBe("unknown");
    }
  });

  it("detects a stale incoming revision", () => {
    expect(
      compareGameItemPlacementRevisions({ revision: 5 }, { revision: 4 }),
    ).toBe("stale");
  });

  it("detects an ahead incoming revision", () => {
    expect(
      compareGameItemPlacementRevisions({ revision: 5 }, { revision: 6 }),
    ).toBe("ahead");
  });

  it("is equivalent for the same event id", () => {
    expect(
      compareGameItemPlacementRevisions(
        { ...base, revision: 2 },
        { revision: 2, content: '{"a":2}', event: { id: "id-1" } },
      ),
    ).toBe("equivalent");
  });

  it("is equivalent for identical original content", () => {
    expect(
      compareGameItemPlacementRevisions(
        { ...base, revision: 2 },
        { revision: 2, content: '{"a":1}', event: { id: "id-2" } },
      ),
    ).toBe("equivalent");
  });

  it("is a conflict when neither id nor content matches", () => {
    expect(
      compareGameItemPlacementRevisions(
        { ...base, revision: 2 },
        { revision: 2, content: '{"a":2}', event: { id: "id-2" } },
      ),
    ).toBe("conflict");
  });

  it("does not treat semantically equal but differently serialized content as equivalent", () => {
    expect(
      compareGameItemPlacementRevisions(
        { revision: 1, content: '{"a":1,"b":2}', event: { id: "x" } },
        { revision: 1, content: '{"b":2,"a":1}', event: { id: "y" } },
      ),
    ).toBe("conflict");
  });

  it("never uses created_at to break an equal-revision tie", () => {
    const current = parseGameItemPlacement(
      makeEvent({
        kind: KIND_GAME_ITEM_PLACEMENT,
        created_at: 1000,
        id: "id-a",
        tags: [["d", "p"]],
        content: JSON.stringify({ revision: 1, placements: [] }),
      }),
    )!;
    const incoming = parseGameItemPlacement(
      makeEvent({
        kind: KIND_GAME_ITEM_PLACEMENT,
        created_at: 999_999,
        id: "id-b",
        tags: [["d", "p"]],
        content: JSON.stringify({
          revision: 1,
          placements: [equipHat],
        }),
      }),
    )!;
    // A much newer created_at does not make it "ahead" or "equivalent".
    expect(compareGameItemPlacementRevisions(current, incoming)).toBe(
      "conflict",
    );
  });

  it("accepts a parsed placement directly", () => {
    const placement = makePlacement([], { revision: 4 });
    expect(compareGameItemPlacementRevisions(placement, placement)).toBe(
      "equivalent",
    );
  });
});

describe("tag helpers and filters", () => {
  it("recognizes item tags only with the item marker", () => {
    expect(isPlacementItemTag(["a", HAT, "", "item"])).toBe(true);
    expect(isPlacementItemTag(["a", HAT, ""])).toBe(false);
    expect(isPlacementItemTag(["a", HAT, "", "based_on"])).toBe(false);
    expect(isPlacementItemTag(["a", "", "", "item"])).toBe(false);
    expect(isPlacementItemTag(["e", HAT, "", "item"])).toBe(false);
  });

  it("recognizes both target tag forms", () => {
    expect(isPlacementTargetTag(["a", CHARACTER, "", "target"])).toBe(true);
    expect(isPlacementTargetTag(["target", "room"])).toBe(true);
    expect(isPlacementTargetTag(["a", CHARACTER, "", "item"])).toBe(false);
    expect(isPlacementTargetTag(["target", ""])).toBe(false);
  });

  it("collects item and target tags from an event", () => {
    const event = makeEvent({
      kind: KIND_GAME_ITEM_PLACEMENT,
      tags: [
        ["d", "p"],
        ["a", CHARACTER, "wss://r", "target"],
        ["a", HAT, "wss://i", "item"],
        ["a", CARROT, "", "based_on"],
      ],
      content: JSON.stringify({ placements: [] }),
    });
    expect(getPlacementItemTags(event)).toEqual([
      { address: HAT, relay: "wss://i", tag: ["a", HAT, "wss://i", "item"] },
    ]);
    expect(getPlacementTargetTags(event)).toEqual([
      {
        type: "address",
        value: CHARACTER,
        relay: "wss://r",
        tag: ["a", CHARACTER, "wss://r", "target"],
      },
    ]);
  });

  it("builds a filter with only the supplied dimensions", () => {
    expect(buildGameItemPlacementFilter()).toEqual({ kinds: [31634] });
    expect(
      buildGameItemPlacementFilter({
        authors: ["a1", "a1", ""],
        placementIds: ["p1"],
        addresses: [HAT, CHARACTER],
      }),
    ).toEqual({
      kinds: [31634],
      authors: ["a1"],
      "#d": ["p1"],
      "#a": [HAT, CHARACTER],
    });
  });

  it("filters events locally by the item marker", () => {
    const matching = makeEvent({
      kind: KIND_GAME_ITEM_PLACEMENT,
      tags: [
        ["d", "p1"],
        ["a", HAT, "", "item"],
      ],
      content: "{}",
    });
    const targetOnly = makeEvent({
      kind: KIND_GAME_ITEM_PLACEMENT,
      tags: [
        ["d", "p2"],
        ["a", HAT, "", "target"],
      ],
      content: "{}",
    });
    // A relay `#a` query would return both; only the first is an item placement.
    expect(
      filterEventsByPlacementItemAddress([matching, targetOnly], HAT),
    ).toEqual([matching]);
  });
});

describe("model guards", () => {
  it("narrows modes", () => {
    expect(isGameItemPlacementMode("equip")).toBe(true);
    expect(isGameItemPlacementMode("place")).toBe(true);
    expect(isGameItemPlacementMode("hover")).toBe(false);
    expect(isGameItemPlacementMode(7)).toBe(false);
  });

  it("narrows targets", () => {
    expect(
      isAddressPlacementTarget({ type: "address", address: CHARACTER }),
    ).toBe(true);
    expect(isInternalPlacementTarget({ type: "internal", id: "room" })).toBe(
      true,
    );
    expect(isAddressPlacementTarget({ type: "geo" })).toBe(false);
    expect(isInternalPlacementTarget({ type: "geo" })).toBe(false);
  });

  it("narrows references", () => {
    const twoD = {
      space: "2d" as const,
      unit: "percent",
      origin: "top-left",
      width: 100,
      height: 100,
    };
    const threeD = {
      space: "3d" as const,
      unit: "meters",
      origin: "center",
    };
    expect(isGameItemPlacement2DReference(twoD)).toBe(true);
    expect(isGameItemPlacement3DReference(threeD)).toBe(true);
    expect(isGameItemPlacement2DReference(threeD)).toBe(false);
    expect(isGameItemPlacement2DReference({ space: "isometric" })).toBe(false);
    expect(isGameItemPlacement3DReference({ space: "isometric" })).toBe(false);
  });

  it("narrows rotations", () => {
    const euler = { type: "euler" as const, unit: "degrees", z: 90 };
    const quat = { type: "quaternion" as const, x: 0, y: 0, z: 0, w: 1 };
    expect(isGameItemPlacementEulerRotation(euler)).toBe(true);
    expect(isGameItemPlacementQuaternionRotation(quat)).toBe(true);
    expect(isGameItemPlacementEulerRotation(quat)).toBe(false);
    expect(isGameItemPlacementQuaternionRotation({ type: "axis-angle" })).toBe(
      false,
    );
  });
});

describe("2D and 3D transform models", () => {
  it("accepts a percent 2D reference", () => {
    const placement = makePlacement([], {
      reference: {
        space: "2d",
        unit: "percent",
        origin: "top-left",
        width: 100,
        height: 100,
      },
    });
    expect(placement.reference).toEqual({
      space: "2d",
      unit: "percent",
      origin: "top-left",
      width: 100,
      height: 100,
    });
  });

  it("accepts a normalized 2D reference", () => {
    const placement = makePlacement([], {
      reference: {
        space: "2d",
        unit: "normalized",
        origin: "center",
        width: 1,
        height: 1,
      },
    });
    expect(placement.reference?.["unit"]).toBe("normalized");
  });

  it("accepts a 3D meter reference and preserves future values", () => {
    const placement = makePlacement(
      [{ id: "x", item: HAT, mode: "place", position: { x: 0, y: 0, z: 0 } }],
      {
        reference: {
          space: "3d",
          unit: "light-years",
          origin: "galactic-center",
          handedness: "left-handed",
          upAxis: "w",
        },
      },
    );
    expect(placement.reference).toEqual({
      space: "3d",
      unit: "light-years",
      origin: "galactic-center",
      handedness: "left-handed",
      upAxis: "w",
    });
  });

  it("accepts z-only and full Euler rotations", () => {
    const placement = makePlacement([
      {
        id: "a",
        item: HAT,
        mode: "place",
        rotation: { type: "euler", unit: "degrees", z: 45 },
      },
      {
        id: "b",
        item: SCARF,
        mode: "place",
        rotation: {
          type: "euler",
          unit: "radians",
          order: "zyx",
          x: 0.1,
          y: 0.2,
          z: 0.3,
        },
      },
    ]);
    expect(placement.placements).toHaveLength(2);
    expect(placement.placements[1]?.rotation?.["order"]).toBe("zyx");
  });

  it("accepts a non-unit quaternion without normalizing it", () => {
    const placement = makePlacement([
      {
        id: "a",
        item: HAT,
        mode: "place",
        rotation: { type: "quaternion", x: 0, y: 0, z: 0, w: 2 },
      },
    ]);
    expect(placement.placements[0]?.rotation).toEqual({
      type: "quaternion",
      x: 0,
      y: 0,
      z: 0,
      w: 2,
    });
  });

  it("preserves an unknown rotation type", () => {
    const placement = makePlacement([
      {
        id: "a",
        item: HAT,
        mode: "place",
        rotation: { type: "axis-angle", axis: [0, 1, 0], angle: 90 },
      },
    ]);
    expect(placement.placements[0]?.rotation?.["type"]).toBe("axis-angle");
  });

  it("accepts 2D scale without z, 3D scale, zero scale and negative scale", () => {
    const placement = makePlacement([
      { id: "a", item: HAT, mode: "place", scale: { x: 1, y: 2 } },
      { id: "b", item: SCARF, mode: "place", scale: { x: 1, y: 1, z: 1 } },
      { id: "c", item: CARROT, mode: "place", scale: { x: 0, y: 0 } },
      { id: "d", item: HAT, mode: "place", scale: { x: -1, y: 1 } },
    ]);
    expect(placement.placements).toHaveLength(4);
    expect(placement.placements[2]?.scale).toEqual({ x: 0, y: 0 });
    expect(placement.placements[3]?.scale).toEqual({ x: -1, y: 1 });
  });

  it("accepts flip, layer, form and view", () => {
    const placement = makePlacement([
      {
        id: "a",
        item: HAT,
        mode: "equip",
        slot: "head",
        flip: { x: true, y: false },
        layer: -1.5,
        form: "baby",
        view: "side-right",
      },
    ]);
    const entry = placement.placements[0];
    expect(entry?.flip).toEqual({ x: true, y: false });
    expect(entry?.layer).toBe(-1.5);
    expect(entry?.form).toBe("baby");
    expect(entry?.view).toBe("side-right");
  });

  it("accepts arbitrary metadata", () => {
    const placement = makePlacement([
      { id: "a", item: HAT, mode: "equip", metadata: [1, "two", { three: 3 }] },
    ]);
    expect(placement.placements[0]?.metadata).toEqual([1, "two", { three: 3 }]);
  });
});
