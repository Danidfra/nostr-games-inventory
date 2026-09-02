import { describe, it, expect } from "vitest";
import {
  parseGameInventory,
  parseGameInventoryResult,
  buildGameInventoryEvent,
  toBuildGameInventoryInput,
  addInventoryItemQuantity,
  setInventoryItemQuantity,
  removeInventoryItemQuantity,
  KIND_GAME_INVENTORY,
  type GameInventory,
} from "../src/index.js";
import { makeEvent, expectOk } from "./helpers.js";

const CARROT = "31632:pubkey123:blobbi:food:carrot";
const HAT = "31632:pubkey123:blobbi:cosmetic:wizard_hat";
const STRAWBERRY = "31632:farmissuer:farm:food:strawberry";

/** Parse a tag list as an inventory, failing the test if it is not valid. */
function parse(tags: string[][], content = ""): GameInventory {
  const event = makeEvent({
    kind: KIND_GAME_INVENTORY,
    pubkey: "owner",
    tags,
    content,
  });
  const inventory = parseGameInventory(event);
  if (inventory === null) {
    throw new Error("Expected the fixture inventory to parse");
  }
  return inventory;
}

/** Rebuild through the safe round-trip path and re-parse the result. */
function rebuild(inventory: GameInventory): GameInventory {
  const template = buildGameInventoryEvent(
    toBuildGameInventoryInput(inventory),
  );
  return parse(template.tags, template.content);
}

function tagNames(tags: string[][], name: string): string[][] {
  return tags.filter(([n]) => n === name);
}

describe("toBuildGameInventoryInput — ordinary round-trip", () => {
  const TAGS: string[][] = [
    ["d", "farm:main"],
    ["context", "game:farm"],
    ["name", "Farm Inventory"],
    ["a", CARROT, "wss://relay.example", "3"],
    ["a", HAT, "", "1"],
    ["e", "grant-1", "wss://grants.example", "grant"],
    ["alt", "Game inventory: Farm"],
  ];

  it("reproduces an identical tag list and content", () => {
    const inventory = parse(TAGS, '{"sort":"category"}');
    const template = buildGameInventoryEvent(
      toBuildGameInventoryInput(inventory),
    );

    expect(template.kind).toBe(KIND_GAME_INVENTORY);
    expect(template.tags).toEqual(TAGS);
    expect(template.content).toBe('{"sort":"category"}');
  });

  it("is idempotent across repeated rebuilds", () => {
    const once = rebuild(parse(TAGS));
    const twice = rebuild(once);
    expect(twice.event.tags).toEqual(once.event.tags);
  });

  it("preserves every structured field", () => {
    const inventory = parse(TAGS);
    const next = rebuild(inventory);

    expect(next.id).toBe("farm:main");
    expect(next.contexts).toEqual(["game:farm"]);
    expect(next.name).toBe("Farm Inventory");
    expect(next.alt).toBe("Game inventory: Farm");
    expect(next.grants).toEqual([
      { eventId: "grant-1", relay: "wss://grants.example" },
    ]);
    expect(next.items).toEqual(inventory.items);
  });

  it("preserves relay hints on items, including the empty one", () => {
    const next = rebuild(parse(TAGS));
    expect(next.items.find((i) => i.address === CARROT)?.relay).toBe(
      "wss://relay.example",
    );
    expect(next.items.find((i) => i.address === HAT)?.relay).toBe("");
  });

  it("round-trips an empty inventory", () => {
    const template = buildGameInventoryEvent(
      toBuildGameInventoryInput(parse([["d", "backpack:main"]])),
    );
    expect(template.tags).toEqual([["d", "backpack:main"]]);
    expect(template.content).toBe("");
  });

  it("round-trips multiple items in order", () => {
    const next = rebuild(parse(TAGS));
    expect(next.items.map((i) => i.address)).toEqual([CARROT, HAT]);
  });

  it("preserves multiple contexts and multiple grants", () => {
    const tags: string[][] = [
      ["d", "chest:home"],
      ["context", "chest:farm"],
      ["context", "storage"],
      ["e", "grant-a", "", "grant"],
      ["e", "grant-b", "", "grant"],
    ];
    const template = buildGameInventoryEvent(
      toBuildGameInventoryInput(parse(tags)),
    );
    expect(template.tags).toEqual(tags);
  });

  it("preserves a non-JSON content string byte-for-byte", () => {
    const inventory = parse([["d", "vault:1"]], "not json at all");
    const template = buildGameInventoryEvent(
      toBuildGameInventoryInput(inventory),
    );
    expect(template.content).toBe("not json at all");
  });
});

describe("toBuildGameInventoryInput — foreign tag preservation", () => {
  /**
   * The exact production concern: another application wrote a tag this
   * application knows nothing about, and a routine quantity change must not
   * destroy it. This is what makes an application-side `extractForeignInventoryTags`
   * unnecessary once a consumer adopts the round-trip path.
   */
  it("keeps a foreign tag exactly once through a quantity change", () => {
    const inventory = parse([
      ["d", "blobbi:island"],
      ["context", "game:blobbi-island"],
      ["name", "Island Inventory"],
      ["allocation", "island-economy:v1"],
      ["a", CARROT, "", "3"],
      ["alt", "Game inventory: Island"],
    ]);

    const next = addInventoryItemQuantity(inventory, STRAWBERRY, 1);
    const template = buildGameInventoryEvent(toBuildGameInventoryInput(next));

    const allocation = tagNames(template.tags, "allocation");
    expect(allocation).toHaveLength(1);
    expect(allocation[0]).toEqual(["allocation", "island-economy:v1"]);

    const rebuilt = parse(template.tags, template.content);
    expect(rebuilt.items).toEqual([
      { address: CARROT, relay: "", quantity: 3 },
      { address: STRAWBERRY, relay: "", quantity: 1 },
    ]);
    expect(rebuilt.name).toBe("Island Inventory");
    expect(rebuilt.contexts).toEqual(["game:blobbi-island"]);
  });

  it("does not accumulate copies of a foreign tag across many rebuilds", () => {
    let inventory = parse([
      ["d", "farm:main"],
      ["allocation", "island-economy:v1"],
      ["a", CARROT, "", "1"],
    ]);

    for (let i = 0; i < 5; i += 1) {
      inventory = rebuild(addInventoryItemQuantity(inventory, CARROT, 1));
    }

    expect(tagNames(inventory.event.tags, "allocation")).toHaveLength(1);
    expect(inventory.items).toEqual([
      { address: CARROT, relay: "", quantity: 6 },
    ]);
  });

  it("preserves several unrelated foreign tags in their original order", () => {
    const inventory = parse([
      ["d", "farm:main"],
      ["zzz", "last"],
      ["client", "some-other-app"],
      ["a", CARROT, "", "1"],
      ["aaa", "first"],
    ]);
    const template = buildGameInventoryEvent(
      toBuildGameInventoryInput(inventory),
    );

    const foreign = template.tags.filter(([n]) =>
      ["zzz", "client", "aaa"].includes(n as string),
    );
    expect(foreign).toEqual([
      ["zzz", "last"],
      ["client", "some-other-app"],
      ["aaa", "first"],
    ]);
  });

  it("preserves a non-grant `e` tag but regenerates grant `e` tags", () => {
    const inventory = parse([
      ["d", "farm:main"],
      ["e", "some-event", "", "reply"],
      ["e", "grant-1", "", "grant"],
    ]);
    const template = buildGameInventoryEvent(
      toBuildGameInventoryInput(inventory),
    );

    expect(tagNames(template.tags, "e")).toEqual([
      ["e", "grant-1", "", "grant"],
      ["e", "some-event", "", "reply"],
    ]);
  });

  it("does not duplicate stale managed tags", () => {
    const inventory = parse([
      ["d", "farm:main"],
      ["context", "game:farm"],
      ["name", "Farm"],
      ["a", CARROT, "", "2"],
      ["alt", "alt text"],
      ["foreign", "keep me"],
    ]);
    const template = buildGameInventoryEvent(
      toBuildGameInventoryInput(inventory),
    );

    for (const name of ["d", "context", "name", "alt"]) {
      expect(tagNames(template.tags, name), name).toHaveLength(1);
    }
    expect(tagNames(template.tags, "a")).toHaveLength(1);
    expect(tagNames(template.tags, "foreign")).toHaveLength(1);
  });

  it("collapses a duplicated managed tag written by a broken publisher", () => {
    const inventory = parse([
      ["d", "farm:main"],
      ["name", "First"],
      ["name", "Second"],
      ["a", CARROT, "", "1"],
    ]);
    const template = buildGameInventoryEvent(
      toBuildGameInventoryInput(inventory),
    );
    expect(tagNames(template.tags, "name")).toEqual([["name", "First"]]);
  });

  it("drops item references the parser rejected, like the 31634 round-trip", () => {
    const result = parseGameInventoryResult(
      makeEvent({
        kind: KIND_GAME_INVENTORY,
        pubkey: "owner",
        tags: [
          ["d", "farm:main"],
          ["a", CARROT, "", "2"],
          ["a", HAT, "", "0"],
        ],
      }),
    );
    const inventory = expectOk(result).value;
    const template = buildGameInventoryEvent(
      toBuildGameInventoryInput(inventory),
    );

    expect(tagNames(template.tags, "a")).toEqual([["a", CARROT, "", "2"]]);
  });
});

describe("preserveTags — direct use on the builder", () => {
  it("strips every managed tag from the preserved list", () => {
    const template = buildGameInventoryEvent({
      id: "farm:main",
      items: [{ address: CARROT, quantity: 1 }],
      preserveTags: [
        ["d", "stale:id"],
        ["revision", "99"],
        ["context", "stale"],
        ["name", "stale"],
        ["alt", "stale"],
        ["a", HAT, "", "7"],
        ["e", "stale-grant", "", "grant"],
        ["keep", "me"],
      ],
    });

    expect(template.tags).toEqual([
      ["d", "farm:main"],
      ["a", CARROT, "", "1"],
      ["keep", "me"],
    ]);
  });

  it("places preserved tags after managed tags and before extraTags", () => {
    const template = buildGameInventoryEvent({
      id: "farm:main",
      alt: "Alt",
      preserveTags: [["preserved", "1"]],
      extraTags: [["extra", "1"]],
    });

    expect(template.tags).toEqual([
      ["d", "farm:main"],
      ["alt", "Alt"],
      ["preserved", "1"],
      ["extra", "1"],
    ]);
  });

  it("copies preserved tags rather than aliasing the caller's arrays", () => {
    const preserved = [["foreign", "value"]];
    const template = buildGameInventoryEvent({
      id: "farm:main",
      preserveTags: preserved,
    });
    preserved[0]![1] = "mutated";
    expect(template.tags).toContainEqual(["foreign", "value"]);
  });

  it("ignores a malformed empty preserved tag", () => {
    const template = buildGameInventoryEvent({
      id: "farm:main",
      preserveTags: [[]],
    });
    expect(template.tags).toEqual([["d", "farm:main"], []]);
  });

  it("is deterministic for identical input", () => {
    const input = {
      id: "farm:main",
      items: [{ address: CARROT, quantity: 2 }],
      preserveTags: [["foreign", "x"]],
    };
    expect(buildGameInventoryEvent(input)).toEqual(
      buildGameInventoryEvent(input),
    );
  });
});

describe("mutation helpers feed the round-trip losslessly", () => {
  const BASE: string[][] = [
    ["d", "farm:main"],
    ["context", "game:farm"],
    ["marker", "written-by-another-app"],
    ["a", CARROT, "wss://relay.example", "5"],
  ];

  it("survives a set", () => {
    const next = setInventoryItemQuantity(parse(BASE), CARROT, 9);
    const rebuilt = rebuild(next);
    expect(rebuilt.items).toEqual([
      { address: CARROT, relay: "wss://relay.example", quantity: 9 },
    ]);
    expect(tagNames(rebuilt.event.tags, "marker")).toHaveLength(1);
  });

  it("survives a removal down to zero", () => {
    const next = removeInventoryItemQuantity(parse(BASE), CARROT, 5);
    const rebuilt = rebuild(next);
    expect(rebuilt.items).toEqual([]);
    expect(tagNames(rebuilt.event.tags, "marker")).toHaveLength(1);
    expect(rebuilt.contexts).toEqual(["game:farm"]);
  });
});
