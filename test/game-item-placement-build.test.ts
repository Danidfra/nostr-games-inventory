import { describe, it, expect } from "vitest";
import {
  buildGameItemPlacementEvent,
  toBuildGameItemPlacementInput,
  parseGameItemPlacement,
  parseGameItemPlacementResult,
  KIND_GAME_ITEM_PLACEMENT,
  type GameItemPlacementEntry,
  type NostrEvent,
} from "../src/index.js";
import { makeEvent, expectOk } from "./helpers.js";

const HAT = "31632:pubkey123:blobbi:cosmetic:wizard_hat";
const SCARF = "31632:pubkey123:blobbi:cosmetic:scarf";
const CARROT = "31632:pubkey123:blobbi:food:carrot";
const CHARACTER = "31124:owner123:blobbi:char-1";

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

/** Turn an unsigned template into a signed-shaped event for round-tripping. */
function asEvent(
  template: { kind: number; content: string; tags: string[][] },
  pubkey = "author1",
): NostrEvent {
  return makeEvent({ ...template, pubkey });
}

describe("buildGameItemPlacementEvent", () => {
  it("emits the canonical kind", () => {
    const event = buildGameItemPlacementEvent({ id: "p" });
    expect(event.kind).toBe(KIND_GAME_ITEM_PLACEMENT);
    expect(event.kind).toBe(31634);
  });

  it("never emits id or sig", () => {
    const event = buildGameItemPlacementEvent({ id: "p" });
    expect(Object.keys(event).sort()).toEqual(["content", "kind", "tags"]);
  });

  it("requires a non-empty d", () => {
    expect(() => buildGameItemPlacementEvent({ id: "" })).toThrow(/`id`/);
    expect(() => buildGameItemPlacementEvent({ id: "   " })).toThrow(/`id`/);
  });

  it("supports empty placements", () => {
    const event = buildGameItemPlacementEvent({ id: "p" });
    expect(JSON.parse(event.content)).toEqual({ placements: [] });
    expect(event.tags).toEqual([["d", "p"]]);
  });

  it("serializes content with the managed keys in a fixed order", () => {
    const event = buildGameItemPlacementEvent({
      id: "p",
      version: 1,
      revision: 4,
      target: { type: "internal", id: "room" },
      reference: {
        space: "2d",
        unit: "percent",
        origin: "top-left",
        width: 100,
        height: 100,
      },
      placements: [equipHat],
      contentExtra: { note: "hello" },
    });
    expect(Object.keys(JSON.parse(event.content) as object)).toEqual([
      "version",
      "revision",
      "target",
      "reference",
      "placements",
      "note",
    ]);
  });

  it("derives an address target tag", () => {
    const event = buildGameItemPlacementEvent({
      id: "p",
      target: { type: "address", address: CHARACTER, relay: "wss://r" },
    });
    expect(event.tags).toContainEqual(["a", CHARACTER, "wss://r", "target"]);
  });

  it("derives an internal target tag", () => {
    const event = buildGameItemPlacementEvent({
      id: "p",
      target: { type: "internal", id: "room:home" },
    });
    expect(event.tags).toContainEqual(["target", "room:home"]);
  });

  it("emits no target tag when there is no target", () => {
    const event = buildGameItemPlacementEvent({ id: "p" });
    expect(event.tags.some((t) => t[0] === "target")).toBe(false);
    expect(event.tags.some((t) => t[3] === "target")).toBe(false);
  });

  it("emits no target tag for an unknown target type", () => {
    const event = buildGameItemPlacementEvent({
      id: "p",
      target: { type: "geo", lat: 1, lon: 2 },
    });
    expect(event.tags.some((t) => t[0] === "target" || t[3] === "target")).toBe(
      false,
    );
    // The target still round-trips through content.
    expect((JSON.parse(event.content) as { target: unknown }).target).toEqual({
      type: "geo",
      lat: 1,
      lon: 2,
    });
  });

  it("derives one item tag per unique item, in first-placement order", () => {
    const event = buildGameItemPlacementEvent({
      id: "p",
      placements: [
        equipScarf,
        equipHat,
        { id: "spare", item: SCARF, mode: "place" },
      ],
    });
    const itemTags = event.tags.filter((t) => t[3] === "item");
    expect(itemTags).toEqual([
      ["a", SCARF, "", "item"],
      ["a", HAT, "", "item"],
    ]);
  });

  it("uses the caller-provided relay map for item tags", () => {
    const event = buildGameItemPlacementEvent({
      id: "p",
      placements: [equipHat],
      relays: { [HAT]: "wss://items.example" },
    });
    expect(event.tags).toContainEqual([
      "a",
      HAT,
      "wss://items.example",
      "item",
    ]);
  });

  it("falls back to a preserved matching relay, then to an empty string", () => {
    const event = buildGameItemPlacementEvent({
      id: "p",
      placements: [equipHat, equipScarf],
      preserveTags: [["a", HAT, "wss://kept.example", "item"]],
    });
    expect(event.tags).toContainEqual(["a", HAT, "wss://kept.example", "item"]);
    expect(event.tags).toContainEqual(["a", SCARF, "", "item"]);
  });

  it("emits contexts, topics and alt", () => {
    const event = buildGameItemPlacementEvent({
      id: "p",
      contexts: ["game:blobbi", "game:blobbi-island"],
      topics: ["equipment", "cosmetic"],
      alt: "Equipment placement",
    });
    expect(event.tags).toEqual([
      ["d", "p"],
      ["context", "game:blobbi"],
      ["context", "game:blobbi-island"],
      ["t", "equipment"],
      ["t", "cosmetic"],
      ["alt", "Equipment placement"],
    ]);
  });

  it("omits blank repeatables and a blank alt", () => {
    const event = buildGameItemPlacementEvent({
      id: "p",
      contexts: ["", "  ", "game:blobbi"],
      topics: ["  "],
      alt: "   ",
    });
    expect(event.tags).toEqual([
      ["d", "p"],
      ["context", "game:blobbi"],
    ]);
  });

  it("preserves unknown and unrelated tags", () => {
    const event = buildGameItemPlacementEvent({
      id: "p",
      placements: [equipHat],
      preserveTags: [
        ["future-tag", "value"],
        ["a", CHARACTER, "", "based_on"],
        ["a", CARROT, ""],
        ["e", "eventid", "", "grant"],
      ],
    });
    expect(event.tags).toContainEqual(["future-tag", "value"]);
    expect(event.tags).toContainEqual(["a", CHARACTER, "", "based_on"]);
    expect(event.tags).toContainEqual(["a", CARROT, ""]);
    expect(event.tags).toContainEqual(["e", "eventid", "", "grant"]);
  });

  it("strips stale managed tags before regenerating them", () => {
    const event = buildGameItemPlacementEvent({
      id: "p2",
      target: { type: "internal", id: "room-new" },
      placements: [equipHat],
      contexts: ["game:new"],
      alt: "new alt",
      preserveTags: [
        ["d", "p1"],
        ["context", "game:old"],
        ["t", "old-topic"],
        ["alt", "old alt"],
        ["target", "room-old"],
        ["a", SCARF, "", "item"],
        ["keep", "me"],
      ],
    });
    expect(event.tags).toEqual([
      ["d", "p2"],
      ["context", "game:new"],
      ["target", "room-new"],
      ["a", HAT, "", "item"],
      ["alt", "new alt"],
      ["keep", "me"],
    ]);
  });

  it("keeps preserved target tags when the input declares no target", () => {
    // Content has no authority to contradict them, so they survive.
    const event = buildGameItemPlacementEvent({
      id: "p",
      preserveTags: [["a", CHARACTER, "wss://r", "target"]],
    });
    expect(event.tags).toContainEqual(["a", CHARACTER, "wss://r", "target"]);
  });

  it("never emits duplicate managed tags", () => {
    const event = buildGameItemPlacementEvent({
      id: "p",
      target: { type: "internal", id: "room" },
      placements: [equipHat, { id: "second", item: HAT, mode: "place" }],
      preserveTags: [
        ["target", "room"],
        ["a", HAT, "", "item"],
        ["a", HAT, "", "item"],
      ],
    });
    expect(event.tags.filter((t) => t[0] === "target")).toHaveLength(1);
    expect(event.tags.filter((t) => t[3] === "item")).toHaveLength(1);
    expect(event.tags.filter((t) => t[0] === "d")).toHaveLength(1);
  });

  it("is deterministic for identical input", () => {
    const input = {
      id: "p",
      version: 1,
      revision: 2,
      target: { type: "internal" as const, id: "room" },
      placements: [equipHat, equipScarf],
      contexts: ["game:blobbi"],
      topics: ["equipment"],
      alt: "Equipment",
      preserveTags: [["keep", "me"]],
    };
    expect(buildGameItemPlacementEvent(input)).toEqual(
      buildGameItemPlacementEvent(input),
    );
    expect(JSON.stringify(buildGameItemPlacementEvent(input))).toBe(
      JSON.stringify(buildGameItemPlacementEvent(input)),
    );
  });

  it("does not mutate its input", () => {
    const placements = [{ ...equipHat, metadata: { deep: [1, 2] } }];
    const input = { id: "p", placements };
    const snapshot = JSON.stringify(input);
    buildGameItemPlacementEvent(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("throws on a malformed target, reference, entry, version or revision", () => {
    expect(() =>
      buildGameItemPlacementEvent({
        id: "p",
        target: { type: "address", address: "nope" },
      }),
    ).toThrow(/target\.address/);
    expect(() =>
      buildGameItemPlacementEvent({
        id: "p",
        reference: { space: "2d", unit: "percent", origin: "top-left" },
      }),
    ).toThrow(/reference\.width/);
    expect(() =>
      buildGameItemPlacementEvent({
        id: "p",
        placements: [{ id: "x", item: "not-an-address", mode: "equip" }],
      }),
    ).toThrow(/placements\[0\]/);
    expect(() =>
      buildGameItemPlacementEvent({ id: "p", revision: 1.5 }),
    ).toThrow(/revision/);
    expect(() => buildGameItemPlacementEvent({ id: "p", version: -1 })).toThrow(
      /version/,
    );
  });

  it("rejects contentExtra keys the builder manages", () => {
    expect(() =>
      buildGameItemPlacementEvent({
        id: "p",
        contentExtra: { placements: [] },
      }),
    ).toThrow(/contentExtra/);
  });

  it("rejects extraTags that conflict with managed tags", () => {
    for (const tag of [
      ["d", "other"],
      ["context", "x"],
      ["t", "x"],
      ["alt", "x"],
      ["target", "x"],
      ["a", HAT, "", "item"],
      ["a", CHARACTER, "", "target"],
    ]) {
      expect(() =>
        buildGameItemPlacementEvent({ id: "p", extraTags: [tag] }),
      ).toThrow(/extraTags/);
    }
  });

  it("allows unrelated a tags in extraTags", () => {
    const event = buildGameItemPlacementEvent({
      id: "p",
      extraTags: [["a", CHARACTER, "", "based_on"]],
    });
    expect(event.tags).toContainEqual(["a", CHARACTER, "", "based_on"]);
  });

  it("requires z in entries when a 3d reference is declared", () => {
    expect(() =>
      buildGameItemPlacementEvent({
        id: "p",
        reference: { space: "3d", unit: "meters", origin: "center" },
        placements: [
          { id: "x", item: HAT, mode: "place", position: { x: 1, y: 1 } },
        ],
      }),
    ).toThrow(/position\.z/);
  });
});

describe("build -> parse round trip", () => {
  it("parses back everything the builder emitted, with no warnings", () => {
    const template = buildGameItemPlacementEvent({
      id: "blobbi-island:character:char-1:equipment",
      version: 1,
      revision: 3,
      target: { type: "address", address: CHARACTER },
      reference: {
        space: "2d",
        unit: "normalized",
        origin: "center",
        width: 1,
        height: 1,
      },
      placements: [equipHat, equipScarf],
      contexts: ["game:blobbi-island"],
      topics: ["equipment"],
      alt: "Equipment",
    });

    const result = expectOk(
      parseGameItemPlacementResult(asEvent(template), { mode: "strict" }),
    );
    expect(result.warnings).toEqual([]);
    expect(result.value.id).toBe("blobbi-island:character:char-1:equipment");
    expect(result.value.revision).toBe(3);
    expect(result.value.placements).toHaveLength(2);
    expect(result.value.itemAddresses).toEqual([HAT, SCARF]);
  });

  it("preserves unknown content fields, unknown entry fields and unknown tags", () => {
    const original = asEvent({
      kind: KIND_GAME_ITEM_PLACEMENT,
      content: JSON.stringify({
        version: 2,
        revision: 5,
        target: { type: "internal", id: "room", futureHint: "keep" },
        reference: { space: "isometric", tileWidth: 64 },
        placements: [
          { ...equipHat, futureField: { nested: true }, metadata: { a: 1 } },
        ],
        futureTopLevel: ["keep", "me"],
      }),
      tags: [
        ["d", "p"],
        ["target", "room"],
        ["a", HAT, "", "item"],
        ["future-tag", "value"],
        ["a", CARROT, "", "based_on"],
      ],
    });

    const placement = parseGameItemPlacement(original);
    expect(placement).not.toBeNull();
    const rebuilt = buildGameItemPlacementEvent(
      toBuildGameItemPlacementInput(placement!),
    );

    const content = JSON.parse(rebuilt.content) as Record<string, unknown>;
    expect(content["futureTopLevel"]).toEqual(["keep", "me"]);
    expect(content["target"]).toEqual({
      type: "internal",
      id: "room",
      futureHint: "keep",
    });
    expect(content["reference"]).toEqual({ space: "isometric", tileWidth: 64 });
    expect(content["version"]).toBe(2);
    expect(content["revision"]).toBe(5);
    const entries = content["placements"] as Record<string, unknown>[];
    expect(entries[0]?.["futureField"]).toEqual({ nested: true });
    expect(entries[0]?.["metadata"]).toEqual({ a: 1 });

    expect(rebuilt.tags).toContainEqual(["future-tag", "value"]);
    expect(rebuilt.tags).toContainEqual(["a", CARROT, "", "based_on"]);
    expect(rebuilt.tags.filter((t) => t[3] === "item")).toEqual([
      ["a", HAT, "", "item"],
    ]);
    expect(rebuilt.tags.filter((t) => t[0] === "target")).toEqual([
      ["target", "room"],
    ]);
  });

  it("repairs stale managed item tags when rebuilding", () => {
    const original = asEvent({
      kind: KIND_GAME_ITEM_PLACEMENT,
      content: JSON.stringify({
        target: { type: "internal", id: "room" },
        placements: [equipHat],
      }),
      tags: [
        ["d", "p"],
        ["target", "room"],
        // Stale: references an item that is not placed, and misses the one that is.
        ["a", CARROT, "", "item"],
      ],
    });
    const parsed = parseGameItemPlacementResult(original);
    expect(expectOk(parsed).warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(["missing-item-tag", "orphaned-item-tag"]),
    );

    const rebuilt = buildGameItemPlacementEvent(
      toBuildGameItemPlacementInput(expectOk(parsed).value),
    );
    expect(rebuilt.tags.filter((t) => t[3] === "item")).toEqual([
      ["a", HAT, "", "item"],
    ]);
    expect(
      expectOk(parseGameItemPlacementResult(asEvent(rebuilt))).warnings,
    ).toEqual([]);
  });

  it("drops entries that were never valid, keeping them on contentJson", () => {
    const original = asEvent({
      kind: KIND_GAME_ITEM_PLACEMENT,
      content: JSON.stringify({
        target: { type: "internal", id: "room" },
        placements: [{ id: "broken" }, equipHat],
      }),
      tags: [
        ["d", "p"],
        ["target", "room"],
        ["a", HAT, "", "item"],
      ],
    });
    const placement = parseGameItemPlacement(original)!;
    expect(placement.contentJson["placements"]).toHaveLength(2);

    const rebuilt = buildGameItemPlacementEvent(
      toBuildGameItemPlacementInput(placement),
    );
    expect(
      (JSON.parse(rebuilt.content) as { placements: unknown[] }).placements,
    ).toHaveLength(1);
  });

  it("round-trips a d value containing colons", () => {
    const template = buildGameItemPlacementEvent({
      id: "blobbi-island:character:char-1:equipment",
    });
    expect(template.tags[0]).toEqual([
      "d",
      "blobbi-island:character:char-1:equipment",
    ]);
    expect(parseGameItemPlacement(asEvent(template))?.id).toBe(
      "blobbi-island:character:char-1:equipment",
    );
  });

  it("bumps the revision without losing anything else", () => {
    const original = asEvent(
      buildGameItemPlacementEvent({
        id: "p",
        revision: 1,
        target: { type: "internal", id: "room" },
        placements: [equipHat],
        contexts: ["game:blobbi"],
        contentExtra: { note: "keep" },
      }),
    );
    const placement = parseGameItemPlacement(original)!;
    const next = buildGameItemPlacementEvent({
      ...toBuildGameItemPlacementInput(placement),
      revision: (placement.revision ?? 0) + 1,
    });
    const content = JSON.parse(next.content) as Record<string, unknown>;
    expect(content["revision"]).toBe(2);
    expect(content["note"]).toBe("keep");
    expect(next.tags).toContainEqual(["context", "game:blobbi"]);
    expect(next.tags).toContainEqual(["a", HAT, "", "item"]);
  });
});
