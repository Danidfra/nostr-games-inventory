import { describe, it, expect } from "vitest";
import {
  parseGameInventory,
  parseGameInventoryResult,
  buildGameInventoryEvent,
  validateGameInventory,
  KIND_GAME_INVENTORY,
} from "../src/index.js";
import { makeEvent, expectOk } from "./helpers.js";

const CARROT = "31632:pubkey123:blobbi:food:carrot";
const HAT = "31632:pubkey123:blobbi:cosmetic:wizard_hat";

describe("validateGameInventory", () => {
  it("accepts a valid inventory", () => {
    const event = makeEvent({ kind: 31633, tags: [["d", "game:blobbi"]] });
    expect(validateGameInventory(event).valid).toBe(true);
  });

  it("rejects wrong kind", () => {
    const event = makeEvent({ kind: 1, tags: [["d", "game:blobbi"]] });
    expect(validateGameInventory(event).issues.map((i) => i.code)).toContain(
      "wrong-kind",
    );
  });

  it("rejects missing d", () => {
    const event = makeEvent({ kind: 31633, tags: [] });
    expect(validateGameInventory(event).issues.map((i) => i.code)).toContain(
      "missing-d",
    );
  });

  it("rejects empty d", () => {
    const event = makeEvent({ kind: 31633, tags: [["d", ""]] });
    expect(validateGameInventory(event).issues.map((i) => i.code)).toContain(
      "empty-d",
    );
  });
});

describe("parseGameInventory", () => {
  it("parses a valid inventory with multiple items", () => {
    const event = makeEvent({
      kind: 31633,
      pubkey: "owner",
      tags: [
        ["d", "game:blobbi"],
        ["context", "game:blobbi"],
        ["name", "Blobbi Inventory"],
        ["a", CARROT, "", "3"],
        ["a", HAT, "", "1"],
        ["alt", "Game inventory: Blobbi"],
      ],
    });
    const inv = parseGameInventory(event);
    expect(inv).not.toBeNull();
    expect(inv?.id).toBe("game:blobbi");
    expect(inv?.address).toBe("31633:owner:game:blobbi");
    expect(inv?.owner).toBe("owner");
    expect(inv?.contexts).toEqual(["game:blobbi"]);
    expect(inv?.name).toBe("Blobbi Inventory");
    expect(inv?.alt).toBe("Game inventory: Blobbi");
    expect(inv?.items).toEqual([
      { address: CARROT, relay: "", quantity: 3 },
      { address: HAT, relay: "", quantity: 1 },
    ]);
  });

  it("parses an empty inventory", () => {
    const event = makeEvent({ kind: 31633, tags: [["d", "game:blobbi"]] });
    const inv = parseGameInventory(event);
    expect(inv?.items).toEqual([]);
  });

  it("returns null when d is missing", () => {
    const event = makeEvent({ kind: 31633, tags: [] });
    expect(parseGameInventory(event)).toBeNull();
  });

  it("preserves an empty relay URL", () => {
    const event = makeEvent({
      kind: 31633,
      tags: [
        ["d", "x"],
        ["a", CARROT, "", "5"],
      ],
    });
    expect(parseGameInventory(event)?.items[0]?.relay).toBe("");
  });

  it("keeps a valid quantity", () => {
    const event = makeEvent({
      kind: 31633,
      tags: [
        ["d", "x"],
        ["a", CARROT, "", "1000"],
      ],
    });
    expect(parseGameInventory(event)?.items[0]?.quantity).toBe(1000);
  });

  it("ignores zero quantity", () => {
    const event = makeEvent({
      kind: 31633,
      tags: [
        ["d", "x"],
        ["a", CARROT, "", "0"],
      ],
    });
    expect(parseGameInventory(event)?.items).toEqual([]);
  });

  it("ignores negative quantity", () => {
    const event = makeEvent({
      kind: 31633,
      tags: [
        ["d", "x"],
        ["a", CARROT, "", "-1"],
      ],
    });
    expect(parseGameInventory(event)?.items).toEqual([]);
  });

  it("ignores decimal quantity", () => {
    const event = makeEvent({
      kind: 31633,
      tags: [
        ["d", "x"],
        ["a", CARROT, "", "1.5"],
      ],
    });
    expect(parseGameInventory(event)?.items).toEqual([]);
  });

  it("ignores non-numeric quantity", () => {
    const event = makeEvent({
      kind: 31633,
      tags: [
        ["d", "x"],
        ["a", CARROT, "", "abc"],
      ],
    });
    expect(parseGameInventory(event)?.items).toEqual([]);
  });

  it("ignores missing quantity", () => {
    const event = makeEvent({
      kind: 31633,
      tags: [
        ["d", "x"],
        ["a", CARROT, ""],
      ],
    });
    const result = expectOk(parseGameInventoryResult(event));
    expect(result.value.items).toEqual([]);
    expect(result.warnings.map((w) => w.code)).toContain("invalid-quantity");
  });

  it("ignores a malformed item address", () => {
    const event = makeEvent({
      kind: 31633,
      tags: [
        ["d", "x"],
        ["a", "31632:onlytwo", "", "3"],
      ],
    });
    const result = expectOk(parseGameInventoryResult(event));
    expect(result.value.items).toEqual([]);
    expect(result.warnings.map((w) => w.code)).toContain("malformed-address");
  });

  it("ignores an item referencing a non-31632 kind", () => {
    const event = makeEvent({
      kind: 31633,
      tags: [
        ["d", "x"],
        ["a", "31633:pk:other:inv", "", "3"],
      ],
    });
    const result = expectOk(parseGameInventoryResult(event));
    expect(result.value.items).toEqual([]);
    expect(result.warnings.map((w) => w.code)).toContain(
      "wrong-referenced-kind",
    );
  });

  describe("duplicate items", () => {
    const dupEvent = makeEvent({
      kind: 31633,
      tags: [
        ["d", "x"],
        ["a", CARROT, "", "3"],
        ["a", CARROT, "", "5"],
      ],
    });

    it("uses the last valid quantity by default (permissive)", () => {
      const inv = parseGameInventory(dupEvent);
      expect(inv?.items).toEqual([{ address: CARROT, relay: "", quantity: 5 }]);
    });

    it("sums quantities with the sum strategy", () => {
      const inv = parseGameInventory(dupEvent, { duplicateStrategy: "sum" });
      expect(inv?.items).toEqual([{ address: CARROT, relay: "", quantity: 8 }]);
    });

    it("rejects duplicates in strict mode", () => {
      expect(parseGameInventory(dupEvent, { mode: "strict" })).toBeNull();
    });

    it("rejects duplicates when strategy is strict", () => {
      const result = parseGameInventoryResult(dupEvent, {
        duplicateStrategy: "strict",
      });
      expect(result.ok).toBe(false);
    });
  });

  it("parses grant e tags with the grant marker", () => {
    const event = makeEvent({
      kind: 31633,
      tags: [
        ["d", "x"],
        ["a", CARROT, "", "3"],
        ["e", "grantEventId123", "", "grant"],
        ["e", "notagrant", "", "reply"],
      ],
    });
    const inv = parseGameInventory(event);
    expect(inv?.grants).toEqual([{ eventId: "grantEventId123", relay: "" }]);
    expect(inv?.grantEventIds).toEqual(["grantEventId123"]);
  });

  it("handles empty content", () => {
    const event = makeEvent({ kind: 31633, tags: [["d", "x"]], content: "" });
    const inv = parseGameInventory(event);
    expect(inv?.content).toBe("");
    expect(inv?.contentJson).toBeUndefined();
  });

  it("parses valid JSON content", () => {
    const content = '{"sort":"category","view":"grid"}';
    const event = makeEvent({ kind: 31633, tags: [["d", "x"]], content });
    const inv = parseGameInventory(event);
    expect(inv?.contentJson).toEqual({ sort: "category", view: "grid" });
    expect(inv?.content).toBe(content);
  });

  it("tolerates invalid JSON content in permissive mode", () => {
    const event = makeEvent({
      kind: 31633,
      tags: [
        ["d", "x"],
        ["a", CARROT, "", "3"],
      ],
      content: "{bad json",
    });
    const result = expectOk(parseGameInventoryResult(event));
    expect(result.value.items).toHaveLength(1);
    expect(result.warnings.map((w) => w.code)).toContain(
      "invalid-json-content",
    );
  });

  it("rejects invalid JSON content in strict mode", () => {
    const event = makeEvent({
      kind: 31633,
      tags: [["d", "x"]],
      content: "{bad json",
    });
    expect(parseGameInventory(event, { mode: "strict" })).toBeNull();
  });
});

describe("buildGameInventoryEvent", () => {
  it("builds a valid inventory template with stable order", () => {
    const tmpl = buildGameInventoryEvent({
      id: "game:blobbi",
      contexts: ["game:blobbi"],
      name: "Blobbi Inventory",
      items: [
        { address: CARROT, quantity: 3 },
        { address: HAT, quantity: 1 },
      ],
      alt: "Game inventory: Blobbi",
    });
    expect(tmpl.kind).toBe(KIND_GAME_INVENTORY);
    expect(tmpl.tags).toEqual([
      ["d", "game:blobbi"],
      ["context", "game:blobbi"],
      ["name", "Blobbi Inventory"],
      ["a", CARROT, "", "3"],
      ["a", HAT, "", "1"],
      ["alt", "Game inventory: Blobbi"],
    ]);
    expect(tmpl.content).toBe("");
  });

  it("omits zero-quantity items", () => {
    const tmpl = buildGameInventoryEvent({
      id: "x",
      items: [{ address: CARROT, quantity: 0 }],
    });
    expect(tmpl.tags.some((t) => t[0] === "a")).toBe(false);
  });

  it("throws on negative, decimal, and non-finite quantities", () => {
    for (const quantity of [-5, 3.9, NaN, Infinity, -Infinity]) {
      expect(() =>
        buildGameInventoryEvent({
          id: "x",
          items: [{ address: CARROT, quantity }],
        }),
      ).toThrow();
    }
  });

  it("throws on unsafe-integer quantities", () => {
    expect(() =>
      buildGameInventoryEvent({
        id: "x",
        items: [{ address: CARROT, quantity: Number.MAX_SAFE_INTEGER + 1 }],
      }),
    ).toThrow();
  });

  it("throws on empty id", () => {
    expect(() => buildGameInventoryEvent({ id: "" })).toThrow();
  });

  it("throws on invalid item address", () => {
    expect(() =>
      buildGameInventoryEvent({
        id: "x",
        items: [{ address: "not-an-address", quantity: 1 }],
      }),
    ).toThrow();
  });

  it("resolves build-time duplicates using last by default", () => {
    const tmpl = buildGameInventoryEvent({
      id: "x",
      items: [
        { address: CARROT, quantity: 3 },
        { address: CARROT, quantity: 5 },
      ],
    });
    expect(tmpl.tags.filter((t) => t[0] === "a")).toEqual([
      ["a", CARROT, "", "5"],
    ]);
  });

  it("throws on build-time duplicates in strict strategy", () => {
    expect(() =>
      buildGameInventoryEvent({
        id: "x",
        duplicateStrategy: "strict",
        items: [
          { address: CARROT, quantity: 3 },
          { address: CARROT, quantity: 5 },
        ],
      }),
    ).toThrow();
  });

  it("round-trips through the parser", () => {
    const tmpl = buildGameInventoryEvent({
      id: "game:blobbi",
      items: [{ address: CARROT, quantity: 3 }],
      grants: [{ eventId: "g1" }],
    });
    const event = makeEvent({ ...tmpl, pubkey: "owner" });
    const inv = parseGameInventory(event);
    expect(inv?.items).toEqual([{ address: CARROT, relay: "", quantity: 3 }]);
    expect(inv?.grantEventIds).toEqual(["g1"]);
  });
});

describe("parser: malformed address vs wrong referenced kind", () => {
  it("emits malformed-address for a generically unparseable address", () => {
    const event = makeEvent({
      kind: 31633,
      tags: [
        ["d", "x"],
        ["a", "not-an-address", "", "3"],
      ],
    });
    const result = expectOk(parseGameInventoryResult(event));
    expect(result.value.items).toEqual([]);
    expect(result.warnings.map((w) => w.code)).toContain("malformed-address");
  });

  it("emits malformed-address even when the prefix is 31632 but coordinate is broken", () => {
    const event = makeEvent({
      kind: 31633,
      tags: [
        ["d", "x"],
        ["a", "31632:onlytwo", "", "3"],
      ],
    });
    const result = expectOk(parseGameInventoryResult(event));
    expect(result.value.items).toEqual([]);
    expect(result.warnings.map((w) => w.code)).toContain("malformed-address");
  });

  it("emits wrong-referenced-kind for a valid non-31632 coordinate", () => {
    const event = makeEvent({
      kind: 31633,
      tags: [
        ["d", "x"],
        ["a", "31633:pk:other:inventory", "", "3"],
      ],
    });
    const result = expectOk(parseGameInventoryResult(event));
    expect(result.value.items).toEqual([]);
    expect(result.warnings.map((w) => w.code)).toContain(
      "wrong-referenced-kind",
    );
  });

  it("classifies by parsed kind, not string prefix", () => {
    // "31632x" is not a numeric kind, so this is malformed (not wrong-kind),
    // proving the distinction is based on generic parsing, not startsWith.
    const event = makeEvent({
      kind: 31633,
      tags: [
        ["d", "x"],
        ["a", "31632x:pk:item", "", "3"],
      ],
    });
    const result = expectOk(parseGameInventoryResult(event));
    const codes = result.warnings.map((w) => w.code);
    expect(codes).toContain("malformed-address");
    expect(codes).not.toContain("wrong-referenced-kind");
  });

  it("respects requireHexPubkey", () => {
    const event = makeEvent({
      kind: 31633,
      tags: [
        ["d", "x"],
        ["a", "31632:pubkey123:blobbi:food:carrot", "", "3"],
      ],
    });
    const result = expectOk(
      parseGameInventoryResult(event, { requireHexPubkey: true }),
    );
    expect(result.value.items).toEqual([]);
    expect(result.warnings.map((w) => w.code)).toContain("malformed-address");
  });
});

describe("parser: duplicate warnings", () => {
  it("emits one duplicate warning per duplicated address, not per item", () => {
    const event = makeEvent({
      kind: 31633,
      tags: [
        ["d", "x"],
        ["a", CARROT, "", "1"],
        ["a", CARROT, "", "2"],
        ["a", CARROT, "", "3"],
        ["a", HAT, "", "1"],
      ],
    });
    const result = expectOk(parseGameInventoryResult(event));
    const dupWarnings = result.warnings.filter(
      (w) => w.code === "duplicate-item",
    );
    expect(dupWarnings).toHaveLength(1);
    // last strategy keeps 3 for CARROT, and HAT is untouched
    expect(result.value.items).toEqual([
      { address: CARROT, relay: "", quantity: 3 },
      { address: HAT, relay: "", quantity: 1 },
    ]);
  });

  it("emits no duplicate warning when there are no real duplicates", () => {
    const event = makeEvent({
      kind: 31633,
      tags: [
        ["d", "x"],
        ["a", CARROT, "", "1"],
        ["a", HAT, "", "2"],
      ],
    });
    const result = expectOk(parseGameInventoryResult(event));
    expect(
      result.warnings.filter((w) => w.code === "duplicate-item"),
    ).toHaveLength(0);
  });

  it("warns per address with sum strategy and preserves first-seen order", () => {
    const event = makeEvent({
      kind: 31633,
      tags: [
        ["d", "x"],
        ["a", HAT, "", "1"],
        ["a", CARROT, "", "2"],
        ["a", HAT, "", "4"],
        ["a", CARROT, "", "3"],
      ],
    });
    const result = expectOk(
      parseGameInventoryResult(event, {
        duplicateStrategy: "sum",
      }),
    );
    expect(
      result.warnings.filter((w) => w.code === "duplicate-item"),
    ).toHaveLength(2);
    expect(result.value.items).toEqual([
      { address: HAT, relay: "", quantity: 5 },
      { address: CARROT, relay: "", quantity: 5 },
    ]);
  });
});

describe("parser: sum overflow", () => {
  it("returns a structured failure when a summed quantity overflows", () => {
    const big = String(Number.MAX_SAFE_INTEGER);
    const event = makeEvent({
      kind: 31633,
      tags: [
        ["d", "x"],
        ["a", CARROT, "", big],
        ["a", CARROT, "", "1"],
      ],
    });
    const result = parseGameInventoryResult(event, {
      duplicateStrategy: "sum",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/MAX_SAFE_INTEGER/);
    }
  });
});

describe("builder: sum overflow", () => {
  it("throws when the summed quantity overflows", () => {
    expect(() =>
      buildGameInventoryEvent({
        id: "x",
        duplicateStrategy: "sum",
        items: [
          { address: CARROT, quantity: Number.MAX_SAFE_INTEGER },
          { address: CARROT, quantity: 1 },
        ],
      }),
    ).toThrow();
  });
});

describe("whitespace-only IDs and metadata", () => {
  it("validation treats whitespace-only d as empty", () => {
    const event = makeEvent({ kind: 31633, tags: [["d", "   "]] });
    expect(validateGameInventory(event).issues.map((i) => i.code)).toContain(
      "empty-d",
    );
    expect(parseGameInventory(event)).toBeNull();
  });

  it("builder throws on whitespace-only id", () => {
    expect(() => buildGameInventoryEvent({ id: "  " })).toThrow();
  });

  it("builder omits whitespace-only name, alt, and contexts", () => {
    const tmpl = buildGameInventoryEvent({
      id: "x",
      name: "  ",
      alt: "\t",
      contexts: ["game:blobbi", "   ", ""],
    });
    expect(tmpl.tags.some((t) => t[0] === "name")).toBe(false);
    expect(tmpl.tags.some((t) => t[0] === "alt")).toBe(false);
    expect(tmpl.tags.filter((t) => t[0] === "context")).toEqual([
      ["context", "game:blobbi"],
    ]);
  });

  it("does not trim valid id or metadata", () => {
    const tmpl = buildGameInventoryEvent({
      id: " game:blobbi ",
      name: " My Inv ",
      contexts: [" game:blobbi "],
    });
    expect(tmpl.tags).toContainEqual(["d", " game:blobbi "]);
    expect(tmpl.tags).toContainEqual(["name", " My Inv "]);
    expect(tmpl.tags).toContainEqual(["context", " game:blobbi "]);
  });
});

describe("extraTags conflict handling", () => {
  it("throws when extraTags contain managed tags", () => {
    for (const name of ["d", "context", "name", "alt"]) {
      expect(() =>
        buildGameInventoryEvent({ id: "x", extraTags: [[name, "value"]] }),
      ).toThrow();
    }
  });

  it("throws when extraTags contain any a tag", () => {
    expect(() =>
      buildGameInventoryEvent({
        id: "x",
        extraTags: [["a", CARROT, "", "3"]],
      }),
    ).toThrow();
    // even an a tag without quantity/marker is rejected (a is item repr)
    expect(() =>
      buildGameInventoryEvent({
        id: "x",
        extraTags: [["a", CARROT, ""]],
      }),
    ).toThrow();
  });

  it("throws when extraTags contain a grant e tag", () => {
    expect(() =>
      buildGameInventoryEvent({
        id: "x",
        extraTags: [["e", "grantid", "", "grant"]],
      }),
    ).toThrow();
  });

  it("allows unrelated forward-compatible tags including non-grant e tags", () => {
    const tmpl = buildGameInventoryEvent({
      id: "x",
      extraTags: [
        ["future-tag", "value"],
        ["e", "someeventid", "", "reply"],
        ["p", "somepubkey"],
      ],
    });
    expect(tmpl.tags).toContainEqual(["future-tag", "value"]);
    expect(tmpl.tags).toContainEqual(["e", "someeventid", "", "reply"]);
    expect(tmpl.tags).toContainEqual(["p", "somepubkey"]);
  });
});

describe("grant handling", () => {
  it("builder rejects a blank grant event id", () => {
    expect(() =>
      buildGameInventoryEvent({ id: "x", grants: [{ eventId: "" }] }),
    ).toThrow();
    expect(() =>
      buildGameInventoryEvent({ id: "x", grants: [{ eventId: "   " }] }),
    ).toThrow();
  });

  it("builder emits a valid grant reference", () => {
    const tmpl = buildGameInventoryEvent({
      id: "x",
      grants: [{ eventId: "grantEventId123", relay: "wss://r" }],
    });
    expect(tmpl.tags).toContainEqual([
      "e",
      "grantEventId123",
      "wss://r",
      "grant",
    ]);
  });

  it("parser ignores malformed grant tags with an invalid-grant-tag warning", () => {
    const event = makeEvent({
      kind: 31633,
      tags: [
        ["d", "x"],
        ["e", "", "", "grant"],
        ["e", "   ", "", "grant"],
        ["e", "validgrantid", "", "grant"],
      ],
    });
    const result = expectOk(parseGameInventoryResult(event));
    expect(result.value.grantEventIds).toEqual(["validgrantid"]);
    const warns = result.warnings.filter((w) => w.code === "invalid-grant-tag");
    expect(warns).toHaveLength(2);
  });

  it("parser uses valid grant references and preserves relay hints", () => {
    const event = makeEvent({
      kind: 31633,
      tags: [
        ["d", "x"],
        ["e", "grantEventId123", "wss://relay.example", "grant"],
        ["e", "notagrant", "", "reply"],
      ],
    });
    const inv = parseGameInventory(event);
    expect(inv?.grants).toEqual([
      { eventId: "grantEventId123", relay: "wss://relay.example" },
    ]);
  });

  it("optionally enforces canonical 64-hex event ids", () => {
    const hex = "a".repeat(64);
    const event = makeEvent({
      kind: 31633,
      tags: [
        ["d", "x"],
        ["e", hex, "", "grant"],
        ["e", "placeholder", "", "grant"],
      ],
    });
    const result = expectOk(
      parseGameInventoryResult(event, {
        requireHexEventId: true,
      }),
    );
    expect(result.value.grantEventIds).toEqual([hex]);
    expect(
      result.warnings.filter((w) => w.code === "invalid-grant-tag"),
    ).toHaveLength(1);
  });
});

describe("canonical inventory fixture", () => {
  it("parses a snapshot with two items, a grant, contexts, and empty content", () => {
    const tmpl = buildGameInventoryEvent({
      id: "game:blobbi",
      contexts: ["game:blobbi"],
      name: "Blobbi Inventory",
      items: [
        { address: CARROT, quantity: 3 },
        { address: HAT, quantity: 1 },
      ],
      grants: [{ eventId: "grantEventId123" }],
      alt: "Game inventory: Blobbi",
    });
    expect(tmpl.content).toBe("");
    const event = makeEvent({ ...tmpl, pubkey: "owner" });
    const inv = parseGameInventory(event);
    expect(inv?.address).toBe("31633:owner:game:blobbi");
    expect(inv?.items).toEqual([
      { address: CARROT, relay: "", quantity: 3 },
      { address: HAT, relay: "", quantity: 1 },
    ]);
    expect(inv?.grantEventIds).toEqual(["grantEventId123"]);
    expect(inv?.contexts).toEqual(["game:blobbi"]);
  });
});
