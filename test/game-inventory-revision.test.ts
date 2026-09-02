import { describe, it, expect } from "vitest";
import {
  parseGameInventory,
  parseGameInventoryResult,
  buildGameInventoryEvent,
  toBuildGameInventoryInput,
  addInventoryItemQuantity,
  compareGameInventoryRevisions,
  parseInventoryRevision,
  encodeInventoryRevision,
  INVENTORY_REVISION_TAG,
  KIND_GAME_INVENTORY,
  type GameInventory,
} from "../src/index.js";
import { makeEvent, expectOk } from "./helpers.js";

const CARROT = "31632:pubkey123:blobbi:food:carrot";

function parse(tags: string[][], content = ""): GameInventory | null {
  return parseGameInventory(
    makeEvent({
      kind: KIND_GAME_INVENTORY,
      pubkey: "owner",
      tags,
      content,
    }),
  );
}

describe("INVENTORY_REVISION_TAG", () => {
  it("is the `revision` tag name", () => {
    expect(INVENTORY_REVISION_TAG).toBe("revision");
  });
});

describe("parseInventoryRevision", () => {
  it("accepts canonical non-negative decimal integers, including zero", () => {
    expect(parseInventoryRevision("0")).toBe(0);
    expect(parseInventoryRevision("1")).toBe(1);
    expect(parseInventoryRevision("9007199254740991")).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });

  it("rejects everything that is not a canonical decimal integer", () => {
    for (const raw of [
      "-1",
      "1.5",
      "abc",
      "1e3",
      "0x1",
      " 1 ",
      "+1",
      "03",
      "",
    ]) {
      expect(parseInventoryRevision(raw), raw).toBeNull();
    }
  });

  it("rejects non-strings and values beyond MAX_SAFE_INTEGER", () => {
    expect(parseInventoryRevision(undefined)).toBeNull();
    expect(parseInventoryRevision(null)).toBeNull();
    expect(parseInventoryRevision("9007199254740993")).toBeNull();
  });
});

describe("encodeInventoryRevision", () => {
  it("encodes non-negative safe integers", () => {
    expect(encodeInventoryRevision(0)).toBe("0");
    expect(encodeInventoryRevision(42)).toBe("42");
  });

  it("throws on negative, decimal and unsafe values", () => {
    expect(() => encodeInventoryRevision(-1)).toThrow();
    expect(() => encodeInventoryRevision(1.5)).toThrow();
    expect(() => encodeInventoryRevision(Number.NaN)).toThrow();
    expect(() => encodeInventoryRevision(2 ** 53)).toThrow();
  });
});

describe("parsing a revision tag", () => {
  it("leaves revision undefined when the tag is absent", () => {
    expect(parse([["d", "farm:main"]])?.revision).toBeUndefined();
  });

  it("reads a valid revision", () => {
    expect(
      parse([
        ["d", "farm:main"],
        ["revision", "4"],
      ])?.revision,
    ).toBe(4);
  });

  it("reads revision zero", () => {
    expect(
      parse([
        ["d", "farm:main"],
        ["revision", "0"],
      ])?.revision,
    ).toBe(0);
  });

  it("warns and ignores a malformed revision in permissive mode", () => {
    const result = parseGameInventoryResult(
      makeEvent({
        kind: KIND_GAME_INVENTORY,
        pubkey: "owner",
        tags: [
          ["d", "farm:main"],
          ["revision", "not-a-number"],
          ["a", CARROT, "", "2"],
        ],
      }),
    );

    const parsed = expectOk(result);
    expect(parsed.value.revision).toBeUndefined();
    // The rest of the inventory is untouched: an advisory counter must never
    // make a player's items disappear.
    expect(parsed.value.items).toEqual([
      { address: CARROT, relay: "", quantity: 2 },
    ]);
    expect(parsed.warnings.map((w) => w.code)).toContain("invalid-revision");
  });

  it("rejects a malformed revision in strict mode", () => {
    const result = parseGameInventoryResult(
      makeEvent({
        kind: KIND_GAME_INVENTORY,
        pubkey: "owner",
        tags: [
          ["d", "farm:main"],
          ["revision", "-3"],
        ],
      }),
      { mode: "strict" },
    );

    expect(result.ok).toBe(false);
  });

  it("emits no warning when there is no revision tag", () => {
    const result = parseGameInventoryResult(
      makeEvent({
        kind: KIND_GAME_INVENTORY,
        pubkey: "owner",
        tags: [["d", "farm:main"]],
      }),
    );
    expect(expectOk(result).warnings).toEqual([]);
  });
});

describe("building a revision tag", () => {
  it("emits no revision tag when omitted", () => {
    const template = buildGameInventoryEvent({ id: "farm:main" });
    expect(template.tags.some(([n]) => n === "revision")).toBe(false);
  });

  it("emits the revision immediately after the d tag", () => {
    const template = buildGameInventoryEvent({
      id: "farm:main",
      revision: 7,
      items: [{ address: CARROT, quantity: 1 }],
    });
    expect(template.tags[0]).toEqual(["d", "farm:main"]);
    expect(template.tags[1]).toEqual(["revision", "7"]);
  });

  it("emits revision zero", () => {
    const template = buildGameInventoryEvent({ id: "farm:main", revision: 0 });
    expect(template.tags).toContainEqual(["revision", "0"]);
  });

  it("throws on an invalid revision", () => {
    for (const revision of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        () => buildGameInventoryEvent({ id: "farm:main", revision }),
        String(revision),
      ).toThrow(/revision/);
    }
  });

  it("rejects a revision tag passed through extraTags", () => {
    expect(() =>
      buildGameInventoryEvent({
        id: "farm:main",
        extraTags: [["revision", "3"]],
      }),
    ).toThrow(/revision/);
  });
});

describe("revision survives the round-trip", () => {
  it("is preserved unchanged by toBuildGameInventoryInput", () => {
    const inventory = parse([
      ["d", "farm:main"],
      ["revision", "12"],
      ["a", CARROT, "", "1"],
    ]);
    const template = buildGameInventoryEvent(
      toBuildGameInventoryInput(inventory as GameInventory),
    );
    expect(template.tags).toContainEqual(["revision", "12"]);
    expect(template.tags.filter(([n]) => n === "revision")).toHaveLength(1);
  });

  it("can be bumped by spreading the round-trip input", () => {
    const inventory = parse([
      ["d", "farm:main"],
      ["revision", "3"],
      ["a", CARROT, "", "1"],
    ]) as GameInventory;

    const next = addInventoryItemQuantity(inventory, CARROT, 1);
    const template = buildGameInventoryEvent({
      ...toBuildGameInventoryInput(next),
      revision: (next.revision ?? 0) + 1,
    });

    expect(template.tags).toContainEqual(["revision", "4"]);
    expect(template.tags).toContainEqual(["a", CARROT, "", "2"]);
  });

  it("starts at 1 when the base carried no revision", () => {
    const inventory = parse([["d", "farm:main"]]) as GameInventory;
    const template = buildGameInventoryEvent({
      ...toBuildGameInventoryInput(inventory),
      revision: (inventory.revision ?? 0) + 1,
    });
    expect(template.tags).toContainEqual(["revision", "1"]);
  });
});

describe("compareGameInventoryRevisions", () => {
  const withTags = (revision: number | undefined, tags: string[][], id = "") =>
    ({
      ...(revision === undefined ? {} : { revision }),
      event: { id, tags },
    }) as const;

  it("returns unknown when either revision is missing", () => {
    expect(
      compareGameInventoryRevisions(
        withTags(undefined, [["d", "a"]]),
        withTags(1, [["d", "a"]]),
      ),
    ).toBe("unknown");
    expect(
      compareGameInventoryRevisions(
        withTags(1, [["d", "a"]]),
        withTags(undefined, [["d", "a"]]),
      ),
    ).toBe("unknown");
    expect(compareGameInventoryRevisions({}, {})).toBe("unknown");
  });

  it("returns unknown for invalid revision values", () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        compareGameInventoryRevisions({ revision: bad }, { revision: 1 }),
        String(bad),
      ).toBe("unknown");
    }
  });

  it("returns stale when the incoming revision is lower", () => {
    expect(
      compareGameInventoryRevisions({ revision: 5 }, { revision: 4 }),
    ).toBe("stale");
  });

  it("returns ahead when the incoming revision is higher", () => {
    expect(
      compareGameInventoryRevisions({ revision: 5 }, { revision: 6 }),
    ).toBe("ahead");
  });

  it("returns equivalent for the same event id", () => {
    expect(
      compareGameInventoryRevisions(
        { revision: 2, event: { id: "abc" } },
        { revision: 2, event: { id: "abc" } },
      ),
    ).toBe("equivalent");
  });

  it("returns equivalent for byte-identical tags", () => {
    const tags = [
      ["d", "farm:main"],
      ["revision", "2"],
      ["a", CARROT, "", "1"],
    ];
    expect(
      compareGameInventoryRevisions(
        withTags(2, tags, "id-a"),
        withTags(
          2,
          tags.map((t) => [...t]),
          "id-b",
        ),
      ),
    ).toBe("equivalent");
  });

  it("returns conflict when equal revisions carry different state", () => {
    expect(
      compareGameInventoryRevisions(
        withTags(
          2,
          [
            ["d", "farm:main"],
            ["a", CARROT, "", "1"],
          ],
          "id-a",
        ),
        withTags(
          2,
          [
            ["d", "farm:main"],
            ["a", CARROT, "", "9"],
          ],
          "id-b",
        ),
      ),
    ).toBe("conflict");
  });

  it("treats a different tag ORDER as a conflict, never normalizing", () => {
    expect(
      compareGameInventoryRevisions(
        withTags(
          1,
          [
            ["d", "farm:main"],
            ["context", "a"],
            ["context", "b"],
          ],
          "id-a",
        ),
        withTags(
          1,
          [
            ["d", "farm:main"],
            ["context", "b"],
            ["context", "a"],
          ],
          "id-b",
        ),
      ),
    ).toBe("conflict");
  });

  it("never uses created_at to break an equal-revision tie", () => {
    const current = {
      revision: 3,
      event: { id: "id-a", tags: [["d", "x"]], created_at: 100 },
    };
    const incoming = {
      revision: 3,
      event: { id: "id-b", tags: [["d", "y"]], created_at: 999_999 },
    };
    expect(compareGameInventoryRevisions(current, incoming)).toBe("conflict");
  });

  it("does not treat an empty or absent tag list as evidence", () => {
    expect(
      compareGameInventoryRevisions(
        { revision: 1, event: { id: "", tags: [] } },
        { revision: 1, event: { id: "", tags: [] } },
      ),
    ).toBe("conflict");
    expect(
      compareGameInventoryRevisions({ revision: 1 }, { revision: 1 }),
    ).toBe("conflict");
  });

  it("does not treat an empty event id as evidence", () => {
    expect(
      compareGameInventoryRevisions(
        { revision: 1, event: { id: "", tags: [["d", "a"]] } },
        { revision: 1, event: { id: "", tags: [["d", "b"]] } },
      ),
    ).toBe("conflict");
  });

  it("tolerates malformed candidate shapes without throwing", () => {
    expect(
      compareGameInventoryRevisions(
        { revision: 1, event: { tags: "nope" as unknown as string[][] } },
        { revision: 1, event: { tags: [["d", "a"]] } },
      ),
    ).toBe("conflict");
  });

  it("accepts a parsed GameInventory directly as a candidate", () => {
    const a = parse([
      ["d", "farm:main"],
      ["revision", "2"],
    ]) as GameInventory;
    const b = parse([
      ["d", "farm:main"],
      ["revision", "3"],
    ]) as GameInventory;

    expect(compareGameInventoryRevisions(a, b)).toBe("ahead");
    expect(compareGameInventoryRevisions(b, a)).toBe("stale");
  });

  it("detects the lost-update scenario the audit described", () => {
    // Both writers read revision 4, both publish revision 5 with different
    // state. A later reader can now see that something was lost.
    const base = parse([
      ["d", "player:shared"],
      ["revision", "4"],
      ["a", CARROT, "", "1"],
    ]) as GameInventory;

    const fromFarm = parseGameInventory(
      makeEvent({
        kind: KIND_GAME_INVENTORY,
        pubkey: "owner",
        id: "farm-event",
        tags: buildGameInventoryEvent({
          ...toBuildGameInventoryInput(
            addInventoryItemQuantity(base, "31632:f:farm:food:strawberry", 1),
          ),
          revision: 5,
        }).tags,
      }),
    ) as GameInventory;

    const fromBlobbi = parseGameInventory(
      makeEvent({
        kind: KIND_GAME_INVENTORY,
        pubkey: "owner",
        id: "blobbi-event",
        tags: buildGameInventoryEvent({
          ...toBuildGameInventoryInput(base),
          revision: 5,
        }).tags,
      }),
    ) as GameInventory;

    expect(compareGameInventoryRevisions(fromFarm, fromBlobbi)).toBe(
      "conflict",
    );
  });
});
