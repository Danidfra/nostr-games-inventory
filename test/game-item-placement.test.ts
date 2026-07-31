import { describe, it, expect } from "vitest";
import {
  parseGameItemPlacement,
  parseGameItemPlacementResult,
  validateGameItemPlacement,
  KIND_GAME_ITEM_PLACEMENT,
  type NostrEvent,
} from "../src/index.js";
import { makeEvent, expectOk } from "./helpers.js";

const HAT = "31632:pubkey123:blobbi:cosmetic:wizard_hat";
const CARROT = "31632:pubkey123:blobbi:food:carrot";
const SCARF = "31632:pubkey123:blobbi:cosmetic:scarf";
const CHARACTER = "31124:owner123:blobbi:char-1";

/** Build a kind:31634 event whose content is the JSON-serialized `content`. */
function placementEvent(
  content: unknown,
  tags: string[][] = [["d", "placement:1"]],
  pubkey = "author1",
): NostrEvent {
  return makeEvent({
    kind: KIND_GAME_ITEM_PLACEMENT,
    pubkey,
    tags,
    content: typeof content === "string" ? content : JSON.stringify(content),
  });
}

/** An `["a", …, "item"]` tag for an item address. */
function itemTag(address: string, relay = ""): string[] {
  return ["a", address, relay, "item"];
}

const equipHat = {
  id: "head",
  item: HAT,
  mode: "equip",
  slot: "head",
};

/** Warning codes of a successful parse. */
function warningCodes(event: NostrEvent): string[] {
  const result = parseGameItemPlacementResult(event);
  return result.warnings.map((w) => w.code);
}

describe("validateGameItemPlacement", () => {
  it("accepts a minimal valid placement", () => {
    const event = placementEvent({ placements: [] });
    expect(validateGameItemPlacement(event).valid).toBe(true);
  });

  it("rejects wrong kind", () => {
    const event = makeEvent({
      kind: 31633,
      tags: [["d", "p"]],
      content: JSON.stringify({ placements: [] }),
    });
    expect(
      validateGameItemPlacement(event).issues.map((i) => i.code),
    ).toContain("wrong-kind");
  });

  it("rejects missing d", () => {
    const event = placementEvent({ placements: [] }, []);
    expect(
      validateGameItemPlacement(event).issues.map((i) => i.code),
    ).toContain("missing-d");
  });

  it("rejects empty d", () => {
    const event = placementEvent({ placements: [] }, [["d", ""]]);
    expect(
      validateGameItemPlacement(event).issues.map((i) => i.code),
    ).toContain("empty-d");
  });

  it("rejects whitespace-only d", () => {
    const event = placementEvent({ placements: [] }, [["d", "   "]]);
    expect(
      validateGameItemPlacement(event).issues.map((i) => i.code),
    ).toContain("empty-d");
  });
});

describe("parseGameItemPlacement: valid documents", () => {
  it("parses empty placements", () => {
    const result = expectOk(
      parseGameItemPlacementResult(placementEvent({ placements: [] })),
    );
    expect(result.value.placements).toEqual([]);
    expect(result.value.itemAddresses).toEqual([]);
    expect(result.value.id).toBe("placement:1");
    expect(result.value.address).toBe("31634:author1:placement:1");
    expect(result.value.author).toBe("author1");
    expect(result.value.kind).toBe(31634);
  });

  it("treats absent placements as an empty list with a warning", () => {
    const event = placementEvent({ target: { type: "internal", id: "room" } });
    const result = expectOk(parseGameItemPlacementResult(event));
    expect(result.value.placements).toEqual([]);
    expect(result.warnings.map((w) => w.code)).toContain(
      "empty-required-value",
    );
  });

  it("parses an equipment placement", () => {
    const event = placementEvent(
      {
        target: { type: "address", address: CHARACTER },
        placements: [equipHat],
      },
      [["d", "placement:1"], ["a", CHARACTER, "", "target"], itemTag(HAT)],
    );
    const placement = parseGameItemPlacement(event);
    expect(placement?.placements).toHaveLength(1);
    expect(placement?.placements[0]?.mode).toBe("equip");
    expect(placement?.placements[0]?.slot).toBe("head");
    expect(placement?.itemAddresses).toEqual([HAT]);
    expect(warningCodes(event)).toEqual([]);
  });

  it("parses a 2D placed object", () => {
    const event = placementEvent(
      {
        target: { type: "internal", id: "room:home" },
        reference: {
          space: "2d",
          unit: "percent",
          origin: "top-left",
          width: 100,
          height: 100,
        },
        placements: [
          {
            id: "rug",
            item: CARROT,
            mode: "place",
            position: { x: 25.5, y: 60 },
            rotation: { type: "euler", unit: "degrees", z: 90 },
            scale: { x: 1, y: 1 },
            flip: { x: false, y: false },
            layer: 3,
          },
        ],
      },
      [["d", "placement:1"], ["target", "room:home"], itemTag(CARROT)],
    );
    const result = expectOk(parseGameItemPlacementResult(event));
    const entry = result.value.placements[0];
    expect(entry?.position).toEqual({ x: 25.5, y: 60 });
    expect(entry?.layer).toBe(3);
    expect(result.value.reference?.space).toBe("2d");
    expect(result.warnings).toEqual([]);
  });

  it("parses a 3D placed object", () => {
    const event = placementEvent(
      {
        reference: {
          space: "3d",
          unit: "meters",
          origin: "center",
          handedness: "right-handed",
          upAxis: "y",
        },
        placements: [
          {
            id: "statue",
            item: CARROT,
            mode: "place",
            position: { x: 1, y: 2, z: 3 },
            rotation: { type: "quaternion", x: 0, y: 0.7071, z: 0, w: 0.7071 },
            scale: { x: 2, y: 2, z: 2 },
          },
        ],
      },
      [["d", "placement:1"], ["target", "world"], itemTag(CARROT)],
    );
    const result = expectOk(parseGameItemPlacementResult(event));
    expect(result.value.placements[0]?.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(result.value.reference?.space).toBe("3d");
  });

  it("parses an addressable target", () => {
    const event = placementEvent(
      {
        target: {
          type: "address",
          address: CHARACTER,
          relay: "wss://r.example",
        },
        placements: [],
      },
      [
        ["d", "placement:1"],
        ["a", CHARACTER, "wss://r.example", "target"],
      ],
    );
    const placement = parseGameItemPlacement(event);
    expect(placement?.target).toEqual({
      type: "address",
      address: CHARACTER,
      relay: "wss://r.example",
    });
    expect(placement?.targetTags).toHaveLength(1);
    expect(placement?.targetTags[0]?.type).toBe("address");
  });

  it("parses an internal target", () => {
    const event = placementEvent(
      { target: { type: "internal", id: "room:home" }, placements: [] },
      [
        ["d", "placement:1"],
        ["target", "room:home"],
      ],
    );
    const placement = parseGameItemPlacement(event);
    expect(placement?.target).toEqual({ type: "internal", id: "room:home" });
    expect(placement?.targetTags[0]).toMatchObject({
      type: "internal",
      value: "room:home",
    });
  });

  it("parses a document with no target at all", () => {
    const event = placementEvent({ placements: [] });
    const result = expectOk(parseGameItemPlacementResult(event));
    expect(result.value.target).toBeUndefined();
    expect(result.value.targetTags).toEqual([]);
    expect(result.warnings.map((w) => w.code)).toContain("missing-target");
  });

  it("parses multiple items and derives unique addresses in first-placement order", () => {
    const event = placementEvent(
      {
        target: { type: "internal", id: "t" },
        placements: [
          { id: "a", item: SCARF, mode: "equip", slot: "neck" },
          { id: "b", item: HAT, mode: "equip", slot: "head" },
          { id: "c", item: SCARF, mode: "equip", slot: "neck-2" },
        ],
      },
      [["d", "p"], ["target", "t"], itemTag(SCARF), itemTag(HAT)],
    );
    const placement = parseGameItemPlacement(event);
    expect(placement?.itemAddresses).toEqual([SCARF, HAT]);
    expect(placement?.placements).toHaveLength(3);
  });

  it("parses repeated contexts and topics", () => {
    const event = placementEvent({ placements: [] }, [
      ["d", "p"],
      ["target", "t"],
      ["context", "game:blobbi"],
      ["context", "game:blobbi-island"],
      ["t", "equipment"],
      ["t", "cosmetic"],
      ["alt", "Equipment placement"],
    ]);
    const placement = parseGameItemPlacement(event);
    expect(placement?.contexts).toEqual(["game:blobbi", "game:blobbi-island"]);
    expect(placement?.topics).toEqual(["equipment", "cosmetic"]);
    expect(placement?.alt).toBe("Equipment placement");
  });

  it("preserves unknown top-level content fields", () => {
    const event = placementEvent({
      placements: [],
      target: { type: "internal", id: "t" },
      futureField: { nested: [1, 2, 3] },
    });
    const placement = parseGameItemPlacement(event);
    expect(placement?.contentJson["futureField"]).toEqual({
      nested: [1, 2, 3],
    });
  });

  it("preserves unknown target fields", () => {
    const event = placementEvent({
      placements: [],
      target: { type: "address", address: CHARACTER, futureHint: "keep-me" },
    });
    const placement = parseGameItemPlacement(event);
    expect(placement?.target?.["futureHint"]).toBe("keep-me");
  });

  it("preserves unknown reference fields and unknown spaces", () => {
    const event = placementEvent({
      placements: [],
      target: { type: "internal", id: "t" },
      reference: { space: "isometric", tileWidth: 64, futureField: true },
    });
    const result = expectOk(parseGameItemPlacementResult(event));
    expect(result.value.reference).toEqual({
      space: "isometric",
      tileWidth: 64,
      futureField: true,
    });
    // Unknown spaces are inert data: preserved without a warning.
    expect(result.warnings.map((w) => w.code)).not.toContain(
      "invalid-reference",
    );
  });

  it("preserves unknown placement entry fields", () => {
    const event = placementEvent({
      placements: [
        { ...equipHat, futureField: { deep: "value" }, anchor: "tip" },
      ],
      target: { type: "internal", id: "t" },
    });
    const placement = parseGameItemPlacement(event);
    expect(placement?.placements[0]?.["futureField"]).toEqual({
      deep: "value",
    });
    expect(placement?.placements[0]?.["anchor"]).toBe("tip");
  });

  it("preserves unknown tags on the event", () => {
    const event = placementEvent({ placements: [] }, [
      ["d", "p"],
      ["target", "t"],
      ["future-tag", "value", "extra"],
      ["a", CHARACTER, "", "some-other-marker"],
    ]);
    const placement = parseGameItemPlacement(event);
    expect(placement?.event.tags).toContainEqual([
      "future-tag",
      "value",
      "extra",
    ]);
    // An `a` tag with a different marker is not an item placement.
    expect(placement?.itemTags).toEqual([]);
    expect(placement?.placements).toEqual([]);
  });

  it("accepts unknown modes with a warning", () => {
    const event = placementEvent(
      {
        target: { type: "internal", id: "t" },
        placements: [{ id: "x", item: HAT, mode: "hover", slot: "aura" }],
      },
      [["d", "p"], ["target", "t"], itemTag(HAT)],
    );
    const result = expectOk(parseGameItemPlacementResult(event));
    expect(result.value.placements).toHaveLength(1);
    expect(result.warnings.map((w) => w.code)).toContain(
      "unknown-placement-mode",
    );
  });

  it("accepts unknown slots without a warning", () => {
    const event = placementEvent(
      {
        target: { type: "internal", id: "t" },
        placements: [
          { id: "x", item: HAT, mode: "equip", slot: "third-antenna" },
        ],
      },
      [["d", "p"], ["target", "t"], itemTag(HAT)],
    );
    const result = expectOk(parseGameItemPlacementResult(event));
    expect(result.value.placements[0]?.slot).toBe("third-antenna");
    expect(result.warnings).toEqual([]);
  });

  it("accepts a missing reference for equipment-only documents without warning", () => {
    const event = placementEvent(
      {
        target: { type: "internal", id: "t" },
        placements: [equipHat],
      },
      [["d", "p"], ["target", "t"], itemTag(HAT)],
    );
    const result = expectOk(parseGameItemPlacementResult(event));
    expect(result.value.reference).toBeUndefined();
    expect(result.warnings.map((w) => w.code)).not.toContain(
      "missing-reference",
    );
  });

  it("warns about a missing reference when an entry carries a position", () => {
    const event = placementEvent(
      {
        target: { type: "internal", id: "t" },
        placements: [
          { id: "x", item: HAT, mode: "place", position: { x: 1, y: 2 } },
        ],
      },
      [["d", "p"], ["target", "t"], itemTag(HAT)],
    );
    expect(warningCodes(event)).toContain("missing-reference");
  });

  it("parses an entry carrying only metadata beyond the required fields", () => {
    const event = placementEvent(
      {
        target: { type: "internal", id: "t" },
        placements: [
          {
            id: "x",
            item: HAT,
            mode: "equip",
            metadata: { note: "player favorite", tags: ["a", "b"], depth: 2 },
          },
        ],
      },
      [["d", "p"], ["target", "t"], itemTag(HAT)],
    );
    const placement = parseGameItemPlacement(event);
    expect(placement?.placements[0]?.metadata).toEqual({
      note: "player favorite",
      tags: ["a", "b"],
      depth: 2,
    });
  });

  it("parses a d value containing colons", () => {
    const event = placementEvent({ placements: [] }, [
      ["d", "blobbi-island:character:char-1:equipment"],
      ["target", "t"],
    ]);
    const placement = parseGameItemPlacement(event);
    expect(placement?.id).toBe("blobbi-island:character:char-1:equipment");
    expect(placement?.address).toBe(
      "31634:author1:blobbi-island:character:char-1:equipment",
    );
  });

  it("exposes version and revision", () => {
    const event = placementEvent({
      version: 1,
      revision: 7,
      target: { type: "internal", id: "t" },
      placements: [],
    });
    const placement = parseGameItemPlacement(event);
    expect(placement?.version).toBe(1);
    expect(placement?.revision).toBe(7);
  });

  it("preserves the raw content string and the full parsed content", () => {
    const raw = JSON.stringify({
      placements: [{ id: "bad" }, equipHat],
      target: { type: "internal", id: "t" },
    });
    const event = makeEvent({
      kind: 31634,
      tags: [["d", "p"]],
      content: raw,
    });
    const placement = parseGameItemPlacement(event);
    expect(placement?.content).toBe(raw);
    // The rejected entry is still available for repair workflows.
    expect(placement?.contentJson["placements"]).toHaveLength(2);
    expect(placement?.placements).toHaveLength(1);
  });
});

describe("parseGameItemPlacement: rejected events", () => {
  const cases: [string, NostrEvent][] = [
    [
      "wrong kind",
      makeEvent({
        kind: 31633,
        tags: [["d", "p"]],
        content: JSON.stringify({ placements: [] }),
      }),
    ],
    ["missing d", placementEvent({ placements: [] }, [])],
    ["empty d", placementEvent({ placements: [] }, [["d", ""]])],
    ["invalid JSON", placementEvent("{not json")],
    ["empty content", placementEvent("")],
    ["content array", placementEvent([1, 2, 3])],
    ["content null", placementEvent(null)],
    ["content string", placementEvent('"just a string"')],
    ["content number", placementEvent("42")],
    ["placements not an array", placementEvent({ placements: "nope" })],
    ["placements object", placementEvent({ placements: { a: 1 } })],
    ["target not an object", placementEvent({ placements: [], target: "x" })],
    ["target array", placementEvent({ placements: [], target: [] })],
    ["target without type", placementEvent({ placements: [], target: {} })],
    [
      "address target without address",
      placementEvent({ placements: [], target: { type: "address" } }),
    ],
    [
      "address target with malformed address",
      placementEvent({
        placements: [],
        target: { type: "address", address: "not-an-address" },
      }),
    ],
    [
      "address target with blank address",
      placementEvent({
        placements: [],
        target: { type: "address", address: "" },
      }),
    ],
    [
      "internal target without id",
      placementEvent({ placements: [], target: { type: "internal" } }),
    ],
    [
      "internal target with empty id",
      placementEvent({ placements: [], target: { type: "internal", id: "" } }),
    ],
    [
      "invalid revision (string)",
      placementEvent({ placements: [], revision: "3" }),
    ],
    [
      "invalid revision (negative)",
      placementEvent({ placements: [], revision: -1 }),
    ],
    [
      "invalid revision (decimal)",
      placementEvent({ placements: [], revision: 1.5 }),
    ],
    [
      "invalid revision (NaN)",
      placementEvent({ placements: [], revision: Number.NaN }),
    ],
    [
      "invalid version (string)",
      placementEvent({ placements: [], version: "1" }),
    ],
  ];

  for (const [name, event] of cases) {
    it(`rejects ${name}`, () => {
      expect(parseGameItemPlacement(event)).toBeNull();
      expect(parseGameItemPlacement(event, { mode: "strict" })).toBeNull();
    });
  }

  it("reports the rejection reason", () => {
    const result = parseGameItemPlacementResult(placementEvent("{nope"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("not valid JSON");
    }
  });

  it("never coerces a numeric revision string", () => {
    // `"3"` must not become `3`; the event is rejected instead.
    expect(
      parseGameItemPlacement(placementEvent({ placements: [], revision: "3" })),
    ).toBeNull();
  });
});

describe("parseGameItemPlacement: malformed entries", () => {
  const badEntries: [string, unknown][] = [
    ["not an object", "nope"],
    ["null entry", null],
    ["missing id", { item: HAT, mode: "equip" }],
    ["empty id", { id: "", item: HAT, mode: "equip" }],
    ["whitespace id", { id: "   ", item: HAT, mode: "equip" }],
    ["missing item", { id: "x", mode: "equip" }],
    ["empty item", { id: "x", item: "", mode: "equip" }],
    [
      "item is not a 31632 address",
      { id: "x", item: CHARACTER, mode: "equip" },
    ],
    ["malformed item address", { id: "x", item: "31632:only", mode: "equip" }],
    ["missing mode", { id: "x", item: HAT }],
    ["empty mode", { id: "x", item: HAT, mode: "" }],
    ["empty slot", { id: "x", item: HAT, mode: "equip", slot: "" }],
    ["non-string slot", { id: "x", item: HAT, mode: "equip", slot: 7 }],
    [
      "malformed position",
      { id: "x", item: HAT, mode: "place", position: { x: 1 } },
    ],
    [
      "position with numeric strings",
      { id: "x", item: HAT, mode: "place", position: { x: "1", y: "2" } },
    ],
    [
      "non-finite position",
      {
        id: "x",
        item: HAT,
        mode: "place",
        position: { x: Number.POSITIVE_INFINITY, y: 0 },
      },
    ],
    [
      "NaN position",
      { id: "x", item: HAT, mode: "place", position: { x: Number.NaN, y: 0 } },
    ],
    [
      "non-finite position z",
      {
        id: "x",
        item: HAT,
        mode: "place",
        position: { x: 0, y: 0, z: Number.NEGATIVE_INFINITY },
      },
    ],
    [
      "malformed euler rotation (no unit)",
      { id: "x", item: HAT, mode: "place", rotation: { type: "euler", z: 90 } },
    ],
    [
      "non-finite euler rotation",
      {
        id: "x",
        item: HAT,
        mode: "place",
        rotation: { type: "euler", unit: "degrees", z: Number.NaN },
      },
    ],
    [
      "euler rotation with numeric string",
      {
        id: "x",
        item: HAT,
        mode: "place",
        rotation: { type: "euler", unit: "degrees", z: "90" },
      },
    ],
    [
      "malformed quaternion (missing w)",
      {
        id: "x",
        item: HAT,
        mode: "place",
        rotation: { type: "quaternion", x: 0, y: 0, z: 0 },
      },
    ],
    [
      "zero quaternion",
      {
        id: "x",
        item: HAT,
        mode: "place",
        rotation: { type: "quaternion", x: 0, y: 0, z: 0, w: 0 },
      },
    ],
    [
      "non-finite quaternion",
      {
        id: "x",
        item: HAT,
        mode: "place",
        rotation: {
          type: "quaternion",
          x: Number.POSITIVE_INFINITY,
          y: 0,
          z: 0,
          w: 1,
        },
      },
    ],
    [
      "rotation without a type",
      { id: "x", item: HAT, mode: "place", rotation: { unit: "degrees" } },
    ],
    ["malformed scale", { id: "x", item: HAT, mode: "place", scale: { x: 1 } }],
    [
      "non-finite scale",
      {
        id: "x",
        item: HAT,
        mode: "place",
        scale: { x: 1, y: Number.POSITIVE_INFINITY },
      },
    ],
    [
      "non-finite scale z",
      {
        id: "x",
        item: HAT,
        mode: "place",
        scale: { x: 1, y: 1, z: Number.NaN },
      },
    ],
    [
      "malformed flip",
      { id: "x", item: HAT, mode: "place", flip: { x: "true", y: false } },
    ],
    ["partial flip", { id: "x", item: HAT, mode: "place", flip: { x: true } }],
    [
      "non-finite layer",
      { id: "x", item: HAT, mode: "place", layer: Number.NaN },
    ],
    [
      "layer as a numeric string",
      { id: "x", item: HAT, mode: "place", layer: "3" },
    ],
    ["empty form", { id: "x", item: HAT, mode: "equip", form: "" }],
    ["empty view", { id: "x", item: HAT, mode: "equip", view: "" }],
  ];

  for (const [name, entry] of badEntries) {
    it(`permissive: drops an entry with ${name} and warns`, () => {
      const event = placementEvent({
        target: { type: "internal", id: "t" },
        placements: [entry, equipHat],
      });
      const result = expectOk(parseGameItemPlacementResult(event));
      expect(result.value.placements).toHaveLength(1);
      expect(result.value.placements[0]?.id).toBe("head");
      expect(result.warnings.map((w) => w.code)).toContain(
        "invalid-placement-entry",
      );
    });

    it(`strict: rejects the event for an entry with ${name}`, () => {
      const event = placementEvent({
        target: { type: "internal", id: "t" },
        placements: [entry, equipHat],
      });
      expect(parseGameItemPlacement(event, { mode: "strict" })).toBeNull();
    });
  }

  it("requires z when the document declares a 3d reference", () => {
    const event = placementEvent({
      target: { type: "internal", id: "t" },
      reference: { space: "3d", unit: "meters", origin: "center" },
      placements: [
        { id: "x", item: HAT, mode: "place", position: { x: 1, y: 2 } },
      ],
    });
    const result = expectOk(parseGameItemPlacementResult(event));
    expect(result.value.placements).toEqual([]);
    expect(result.warnings.map((w) => w.code)).toContain(
      "invalid-placement-entry",
    );
  });

  it("allows a 2D position without z", () => {
    const event = placementEvent({
      target: { type: "internal", id: "t" },
      reference: {
        space: "2d",
        unit: "normalized",
        origin: "center",
        width: 1,
        height: 1,
      },
      placements: [
        { id: "x", item: HAT, mode: "place", position: { x: 0.5, y: 0.5 } },
      ],
    });
    expect(parseGameItemPlacement(event)?.placements).toHaveLength(1);
  });

  it("drops a malformed reference with a warning in permissive mode", () => {
    const event = placementEvent({
      target: { type: "internal", id: "t" },
      reference: { space: "2d", unit: "percent", origin: "top-left" },
      placements: [],
    });
    const result = expectOk(parseGameItemPlacementResult(event));
    expect(result.value.reference).toBeUndefined();
    expect(result.warnings.map((w) => w.code)).toContain("invalid-reference");
  });

  it("rejects a malformed reference in strict mode", () => {
    const event = placementEvent({
      target: { type: "internal", id: "t" },
      reference: { space: "2d", unit: "percent", origin: "top-left", width: 1 },
      placements: [],
    });
    expect(parseGameItemPlacement(event, { mode: "strict" })).toBeNull();
  });

  it("rejects a non-finite reference dimension", () => {
    const event = placementEvent({
      target: { type: "internal", id: "t" },
      reference: {
        space: "2d",
        unit: "percent",
        origin: "top-left",
        width: Number.POSITIVE_INFINITY,
        height: 100,
      },
      placements: [],
    });
    expect(warningCodes(event)).toContain("invalid-reference");
  });
});

describe("parseGameItemPlacement: tag reconciliation warnings", () => {
  it("warns when a placed item has no derived item tag", () => {
    const event = placementEvent(
      {
        target: { type: "internal", id: "t" },
        placements: [equipHat],
      },
      [
        ["d", "p"],
        ["target", "t"],
      ],
    );
    expect(warningCodes(event)).toContain("missing-item-tag");
  });

  it("warns about an orphaned item tag and never treats it as a placement", () => {
    const event = placementEvent(
      { target: { type: "internal", id: "t" }, placements: [] },
      [["d", "p"], ["target", "t"], itemTag(HAT)],
    );
    const result = expectOk(parseGameItemPlacementResult(event));
    expect(result.value.placements).toEqual([]);
    expect(result.warnings.map((w) => w.code)).toContain("orphaned-item-tag");
  });

  it("warns about duplicate item tags", () => {
    const event = placementEvent(
      { target: { type: "internal", id: "t" }, placements: [equipHat] },
      [["d", "p"], ["target", "t"], itemTag(HAT), itemTag(HAT, "wss://other")],
    );
    expect(warningCodes(event)).toContain("duplicate-item-tag");
  });

  it("warns about duplicate target tags", () => {
    const event = placementEvent(
      { target: { type: "internal", id: "t" }, placements: [] },
      [
        ["d", "p"],
        ["target", "t"],
        ["a", CHARACTER, "", "target"],
      ],
    );
    expect(warningCodes(event)).toContain("duplicate-target-tag");
  });

  it("warns when target tags contradict the authoritative content target", () => {
    const event = placementEvent(
      {
        target: { type: "address", address: CHARACTER },
        placements: [],
      },
      [
        ["d", "p"],
        ["a", "31124:other:char-9", "", "target"],
      ],
    );
    const result = expectOk(parseGameItemPlacementResult(event));
    expect(result.warnings.map((w) => w.code)).toContain("target-mismatch");
    // Content stays authoritative.
    expect(result.value.target?.["address"]).toBe(CHARACTER);
  });

  it("warns when the authoritative target has no tag at all", () => {
    const event = placementEvent(
      { target: { type: "internal", id: "room" }, placements: [] },
      [["d", "p"]],
    );
    expect(warningCodes(event)).toContain("target-mismatch");
  });

  it("does not warn about a mismatch for an unknown target type", () => {
    const event = placementEvent(
      { target: { type: "geo", lat: 1, lon: 2 }, placements: [] },
      [["d", "p"]],
    );
    const result = expectOk(parseGameItemPlacementResult(event));
    expect(result.warnings.map((w) => w.code)).not.toContain("target-mismatch");
    expect(result.value.target).toEqual({ type: "geo", lat: 1, lon: 2 });
  });

  it("exposes target tags as metadata when content declares no target", () => {
    const event = placementEvent({ placements: [] }, [
      ["d", "p"],
      ["a", CHARACTER, "wss://r", "target"],
    ]);
    const result = expectOk(parseGameItemPlacementResult(event));
    expect(result.value.target).toBeUndefined();
    expect(result.value.targetTags[0]).toMatchObject({
      type: "address",
      value: CHARACTER,
      relay: "wss://r",
    });
    expect(result.warnings.map((w) => w.code)).not.toContain("missing-target");
    expect(result.warnings.map((w) => w.code)).not.toContain("target-mismatch");
  });

  it("warns about duplicate placement ids without rejecting", () => {
    const event = placementEvent(
      {
        target: { type: "internal", id: "t" },
        placements: [equipHat, { ...equipHat, item: SCARF }],
      },
      [["d", "p"], ["target", "t"], itemTag(HAT), itemTag(SCARF)],
    );
    const result = expectOk(parseGameItemPlacementResult(event));
    expect(result.value.placements).toHaveLength(2);
    expect(result.warnings.map((w) => w.code)).toContain(
      "duplicate-placement-id",
    );
  });

  it("warns about duplicate equip slots without rejecting", () => {
    const event = placementEvent(
      {
        target: { type: "internal", id: "t" },
        placements: [
          equipHat,
          { id: "head-2", item: SCARF, mode: "equip", slot: "head" },
        ],
      },
      [["d", "p"], ["target", "t"], itemTag(HAT), itemTag(SCARF)],
    );
    const result = expectOk(parseGameItemPlacementResult(event));
    expect(result.value.placements).toHaveLength(2);
    expect(result.warnings.map((w) => w.code)).toContain(
      "duplicate-equip-slot",
    );
  });

  it("does not warn about the same slot used by different modes", () => {
    const event = placementEvent(
      {
        target: { type: "internal", id: "t" },
        placements: [
          equipHat,
          { id: "shelf", item: SCARF, mode: "place", slot: "head" },
        ],
      },
      [["d", "p"], ["target", "t"], itemTag(HAT), itemTag(SCARF)],
    );
    expect(warningCodes(event)).not.toContain("duplicate-equip-slot");
  });

  it("keeps tag mismatches as warnings in strict mode", () => {
    const event = placementEvent(
      { target: { type: "internal", id: "t" }, placements: [equipHat] },
      [
        ["d", "p"],
        ["target", "t"],
      ],
    );
    const result = parseGameItemPlacementResult(event, { mode: "strict" });
    expect(result.ok).toBe(true);
    expect(result.warnings.map((w) => w.code)).toContain("missing-item-tag");
  });

  it("produces no warnings for a fully canonical document", () => {
    const event = placementEvent(
      {
        version: 1,
        revision: 2,
        target: { type: "address", address: CHARACTER },
        reference: {
          space: "2d",
          unit: "normalized",
          origin: "center",
          width: 1,
          height: 1,
        },
        placements: [equipHat],
      },
      [
        ["d", "p"],
        ["context", "game:blobbi"],
        ["a", CHARACTER, "", "target"],
        itemTag(HAT),
        ["alt", "Equipment"],
      ],
    );
    expect(warningCodes(event)).toEqual([]);
  });
});

describe("parseGameItemPlacement: hex pubkey option", () => {
  const hexPubkey = "a".repeat(64);
  const hexItem = `31632:${hexPubkey}:blobbi:cosmetic:wizard_hat`;

  it("accepts placeholder pubkeys by default", () => {
    const event = placementEvent({
      target: { type: "internal", id: "t" },
      placements: [equipHat],
    });
    expect(parseGameItemPlacement(event)?.placements).toHaveLength(1);
  });

  it("drops entries with non-hex pubkeys when requireHexPubkey is set", () => {
    const event = placementEvent({
      target: { type: "internal", id: "t" },
      placements: [equipHat, { id: "ok", item: hexItem, mode: "equip" }],
    });
    const result = expectOk(
      parseGameItemPlacementResult(event, { requireHexPubkey: true }),
    );
    expect(result.value.placements.map((e) => e.id)).toEqual(["ok"]);
  });
});
