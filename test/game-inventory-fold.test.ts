import { describe, it, expect } from "vitest";
import {
  KIND_GAME_INVENTORY_FOLD,
  FOLD_PREVIOUS_MARKER,
  FOLD_SPEND_MARKER,
  FOLD_VOID_MARKER,
  INVENTORY_MARKER,
  parseGameInventoryFold,
  parseGameInventoryFoldResult,
  validateGameInventoryFold,
  buildGameInventoryFoldEvent,
  buildGameInventoryFoldFilter,
  toBuildGameInventoryFoldInput,
  resolveGameInventoryFoldChain,
  deriveGameInventoryState,
  type NostrEvent,
} from "../src/index.js";
import { makeEvent, expectOk } from "./helpers.js";
import {
  OWNER,
  ATTACKER,
  FARM,
  ISLAND,
  STRAWBERRY,
  spendEvent,
  foldEvent,
  snapshot,
} from "./spend-fixtures.js";

const INVENTORY_TAG = ["a", FARM, "", INVENTORY_MARKER];
const SPEND_TAG = ["e", "s1", "", FOLD_SPEND_MARKER];

function event(
  tags: string[][],
  overrides: Partial<NostrEvent> = {},
): NostrEvent {
  return makeEvent({
    kind: KIND_GAME_INVENTORY_FOLD,
    pubkey: OWNER,
    id: "m1",
    tags,
    ...overrides,
  });
}

function codes(e: NostrEvent): string[] {
  return validateGameInventoryFold(e).issues.map((i) => i.code);
}

describe("constants", () => {
  it("registers kind 1417 and the marker vocabulary", () => {
    expect(KIND_GAME_INVENTORY_FOLD).toBe(1417);
    expect(FOLD_PREVIOUS_MARKER).toBe("previous");
    expect(FOLD_SPEND_MARKER).toBe("spend");
    expect(FOLD_VOID_MARKER).toBe("void");
  });
});

describe("parseGameInventoryFold", () => {
  it("parses a first manifest (no previous)", () => {
    const { value, warnings } = expectOk(
      parseGameInventoryFoldResult(
        event([
          ["a", FARM, "wss://inv", INVENTORY_MARKER],
          ["e", "s1", "wss://a", FOLD_SPEND_MARKER],
          ["e", "s2", "", FOLD_SPEND_MARKER],
          ["e", "s3", "", FOLD_VOID_MARKER],
          ["alt", "Folded 2 spends"],
        ]),
      ),
    );
    expect(warnings).toEqual([]);
    expect(value.id).toBe("m1");
    expect(value.owner).toBe(OWNER);
    expect(value.inventoryAddress).toBe(FARM);
    expect(value.inventoryRelay).toBe("wss://inv");
    expect(value.previous).toBeUndefined();
    expect(value.spends).toEqual([
      { eventId: "s1", relay: "wss://a" },
      { eventId: "s2", relay: "" },
    ]);
    expect(value.spendIds).toEqual(["s1", "s2"]);
    expect(value.voidIds).toEqual(["s3"]);
    expect(value.alt).toBe("Folded 2 spends");
  });

  it("parses a chained manifest", () => {
    const fold = parseGameInventoryFold(
      event([
        INVENTORY_TAG,
        ["e", "m0", "wss://p", FOLD_PREVIOUS_MARKER],
        SPEND_TAG,
      ]),
    );
    expect(fold?.previous).toEqual({ eventId: "m0", relay: "wss://p" });
  });

  it("rejects wrong kind and missing id", () => {
    expect(codes(event([INVENTORY_TAG, SPEND_TAG], { kind: 1416 }))).toEqual([
      "wrong-kind",
    ]);
    const e = event([INVENTORY_TAG, SPEND_TAG]);
    delete e.id;
    expect(codes(e)).toEqual(["missing-event-id"]);
  });

  it("rejects a manifest authored by someone other than the owner", () => {
    expect(
      codes(event([INVENTORY_TAG, SPEND_TAG], { pubkey: ATTACKER })),
    ).toEqual(["author-mismatch"]);
  });

  it("rejects missing, duplicate, malformed and wrong-kind inventory references", () => {
    expect(codes(event([SPEND_TAG]))).toEqual(["missing-inventory-reference"]);
    expect(codes(event([INVENTORY_TAG, INVENTORY_TAG, SPEND_TAG]))).toEqual([
      "duplicate-inventory-reference",
    ]);
    expect(
      codes(event([["a", "farm", "", INVENTORY_MARKER], SPEND_TAG])),
    ).toEqual(["malformed-inventory-address"]);
    expect(
      codes(
        event([["a", STRAWBERRY, "", INVENTORY_MARKER], SPEND_TAG], {
          pubkey: "issuer",
        }),
      ),
    ).toEqual(["wrong-inventory-kind"]);
  });

  it("rejects a manifest with no spend or void references", () => {
    expect(codes(event([INVENTORY_TAG]))).toEqual(["no-spend-references"]);
    expect(
      codes(event([INVENTORY_TAG, ["e", "m0", "", FOLD_PREVIOUS_MARKER]])),
    ).toEqual(["no-spend-references"]);
  });

  it("rejects duplicate spend references instead of deduplicating", () => {
    expect(codes(event([INVENTORY_TAG, SPEND_TAG, SPEND_TAG]))).toEqual([
      "duplicate-spend-reference",
    ]);
    expect(
      codes(
        event([INVENTORY_TAG, SPEND_TAG, ["e", "s1", "", FOLD_VOID_MARKER]]),
      ),
    ).toEqual(["duplicate-spend-reference"]);
  });

  it("rejects a blank spend reference, more than one previous, and self references", () => {
    expect(
      codes(event([INVENTORY_TAG, ["e", "", "", FOLD_SPEND_MARKER]])),
    ).toEqual(["invalid-spend-reference"]);
    expect(
      codes(
        event([
          INVENTORY_TAG,
          ["e", "m0", "", FOLD_PREVIOUS_MARKER],
          ["e", "m00", "", FOLD_PREVIOUS_MARKER],
          SPEND_TAG,
        ]),
      ),
    ).toEqual(["duplicate-previous-reference"]);
    expect(
      codes(
        event([
          INVENTORY_TAG,
          ["e", "m1", "", FOLD_PREVIOUS_MARKER],
          SPEND_TAG,
        ]),
      ),
    ).toEqual(["self-reference"]);
    expect(
      codes(
        event([
          INVENTORY_TAG,
          ["e", "m0", "", FOLD_PREVIOUS_MARKER],
          ["e", "m0", "", FOLD_SPEND_MARKER],
        ]),
      ),
    ).toEqual(["previous-is-spend"]);
  });

  it("ignores unrelated e tags and unknown tags", () => {
    const fold = parseGameInventoryFold(
      event([
        INVENTORY_TAG,
        ["e", "other", "", "reply"],
        ["e", "bare"],
        SPEND_TAG,
        ["x", "y"],
      ]),
    );
    expect(fold?.spendIds).toEqual(["s1"]);
    expect(fold?.voidIds).toEqual([]);
  });

  it("honours requireHexEventId for every referenced id", () => {
    const e = event([INVENTORY_TAG, SPEND_TAG]);
    expect(parseGameInventoryFold(e)).not.toBeNull();
    expect(parseGameInventoryFold(e, { requireHexEventId: true })).toBeNull();
  });

  it("invalid JSON content warns in permissive mode and rejects in strict", () => {
    const e = event([INVENTORY_TAG, SPEND_TAG], { content: "{" });
    expect(
      expectOk(parseGameInventoryFoldResult(e)).warnings.map((w) => w.code),
    ).toEqual(["invalid-json-content"]);
    expect(parseGameInventoryFoldResult(e, { mode: "strict" }).ok).toBe(false);
  });
});

describe("buildGameInventoryFoldEvent", () => {
  it("emits the fixed tag order", () => {
    const template = buildGameInventoryFoldEvent({
      inventoryAddress: FARM,
      inventoryRelay: "wss://inv",
      previous: { eventId: "m0", relay: "wss://p" },
      spends: [{ eventId: "s1" }, { eventId: "s2", relay: "wss://s" }],
      voids: [{ eventId: "s3" }],
      alt: "fold",
      extraTags: [["x", "y"]],
    });
    expect(template).toEqual({
      kind: 1417,
      content: "",
      tags: [
        ["a", FARM, "wss://inv", "inventory"],
        ["e", "m0", "wss://p", "previous"],
        ["e", "s1", "", "spend"],
        ["e", "s2", "wss://s", "spend"],
        ["e", "s3", "", "void"],
        ["alt", "fold"],
        ["x", "y"],
      ],
    });
  });

  it("builds a first manifest without previous", () => {
    const template = buildGameInventoryFoldEvent({
      inventoryAddress: FARM,
      spends: [{ eventId: "s1" }],
    });
    expect(template.tags).toEqual([
      ["a", FARM, "", "inventory"],
      ["e", "s1", "", "spend"],
    ]);
  });

  it("refuses a zero-reference manifest", () => {
    expect(() =>
      buildGameInventoryFoldEvent({ inventoryAddress: FARM }),
    ).toThrow(/at least one/);
    expect(() =>
      buildGameInventoryFoldEvent({
        inventoryAddress: FARM,
        previous: { eventId: "m0" },
        spends: [],
      }),
    ).toThrow(/at least one/);
  });

  it("refuses invalid addresses, blank ids, duplicates and previous-as-spend", () => {
    expect(() =>
      buildGameInventoryFoldEvent({
        inventoryAddress: STRAWBERRY,
        spends: [{ eventId: "s1" }],
      }),
    ).toThrow(/inventoryAddress/);
    expect(() =>
      buildGameInventoryFoldEvent({
        inventoryAddress: FARM,
        spends: [{ eventId: " " }],
      }),
    ).toThrow(/non-empty/);
    expect(() =>
      buildGameInventoryFoldEvent({
        inventoryAddress: FARM,
        spends: [{ eventId: "s1" }, { eventId: "s1" }],
      }),
    ).toThrow(/more than once/);
    expect(() =>
      buildGameInventoryFoldEvent({
        inventoryAddress: FARM,
        spends: [{ eventId: "s1" }],
        voids: [{ eventId: "s1" }],
      }),
    ).toThrow(/more than once/);
    expect(() =>
      buildGameInventoryFoldEvent({
        inventoryAddress: FARM,
        previous: { eventId: "m0" },
        spends: [{ eventId: "m0" }],
      }),
    ).toThrow(/more than once/);
  });

  it("rejects extraTags that collide with managed tags", () => {
    for (const tag of [
      ["a", ISLAND, "", "inventory"],
      ["e", "z", "", "spend"],
      ["alt", "x"],
    ]) {
      expect(() =>
        buildGameInventoryFoldEvent({
          inventoryAddress: FARM,
          spends: [{ eventId: "s1" }],
          extraTags: [tag],
        }),
      ).toThrow(/extraTags/);
    }
  });

  it("round-trips through the parser", () => {
    const template = buildGameInventoryFoldEvent({
      inventoryAddress: FARM,
      previous: { eventId: "m0" },
      spends: [{ eventId: "s1" }],
      voids: [{ eventId: "s2" }],
    });
    const fold = parseGameInventoryFold(
      makeEvent({ ...template, id: "m1", pubkey: OWNER }),
    );
    expect(fold?.previous?.eventId).toBe("m0");
    expect(fold?.spendIds).toEqual(["s1"]);
    expect(fold?.voidIds).toEqual(["s2"]);
  });
});

describe("toBuildGameInventoryFoldInput", () => {
  it("returns null when there is nothing to settle", () => {
    const state = deriveGameInventoryState({
      inventory: snapshot({ items: { [STRAWBERRY]: 1 }, fold: "m0" }),
      spends: [spendEvent({ id: "s1" })],
      foldedSpendIds: ["s1"],
    });
    expect(toBuildGameInventoryFoldInput(state)).toBeNull();
  });

  it("folds applied spends, voids rejected ones and chains to the base fold", () => {
    const state = deriveGameInventoryState({
      inventory: snapshot({ items: { [STRAWBERRY]: 1 }, fold: "m0" }),
      spends: [
        spendEvent({ id: "s1", createdAt: 1 }),
        spendEvent({ id: "s2", createdAt: 2 }),
        spendEvent({ id: "i1", inventory: ISLAND }),
        spendEvent({ id: "x1", pubkey: ATTACKER }),
      ],
    });
    expect(toBuildGameInventoryFoldInput(state)).toEqual({
      inventoryAddress: FARM,
      previous: { eventId: "m0", relay: "" },
      spends: [{ eventId: "s1", relay: "" }],
      voids: [{ eventId: "s2", relay: "" }],
    });
  });

  it("omits previous for a first fold", () => {
    const state = deriveGameInventoryState({
      inventory: snapshot({ items: { [STRAWBERRY]: 1 } }),
      spends: [spendEvent({ id: "s1" })],
    });
    const input = toBuildGameInventoryFoldInput(state);
    expect(input?.previous).toBeUndefined();
    expect(() => buildGameInventoryFoldEvent(input as never)).not.toThrow();
  });
});

describe("buildGameInventoryFoldFilter", () => {
  it("builds by ids and by owner + inventory", () => {
    expect(buildGameInventoryFoldFilter({ ids: ["m1", "m1"] })).toEqual({
      kinds: [1417],
      ids: ["m1"],
    });
    expect(
      buildGameInventoryFoldFilter({
        authors: [OWNER],
        inventoryAddresses: [FARM],
      }),
    ).toEqual({ kinds: [1417], authors: [OWNER], "#a": [FARM] });
    expect(buildGameInventoryFoldFilter()).toEqual({ kinds: [1417] });
  });
});

describe("resolveGameInventoryFoldChain", () => {
  it("resolves trivially with no head fold", () => {
    const r = resolveGameInventoryFoldChain({
      inventoryAddress: FARM,
      folds: [],
    });
    expect(r).toEqual({
      status: "resolved",
      chain: [],
      foldedSpendIds: [],
      voidedSpendIds: [],
      settledSpendIds: [],
      problems: [],
      warnings: [],
    });
  });

  it("resolves a first manifest", () => {
    const r = resolveGameInventoryFoldChain({
      inventoryAddress: FARM,
      headFoldId: "m1",
      folds: [foldEvent({ id: "m1", spends: ["s1", "s2"], voids: ["s3"] })],
    });
    expect(r.status).toBe("resolved");
    expect(r.headFoldId).toBe("m1");
    expect(r.chain.map((f) => f.id)).toEqual(["m1"]);
    expect(r.foldedSpendIds).toEqual(["s1", "s2"]);
    expect(r.voidedSpendIds).toEqual(["s3"]);
    expect(r.settledSpendIds).toEqual(["s1", "s2", "s3"]);
  });

  it("walks a chain head-first and unions every manifest, ignoring unrelated folds", () => {
    const r = resolveGameInventoryFoldChain({
      inventoryAddress: FARM,
      headFoldId: "m3",
      folds: [
        foldEvent({ id: "m1", spends: ["s1"] }),
        foldEvent({ id: "orphan", spends: ["s9"] }),
        foldEvent({ id: "m3", previous: "m2", spends: ["s3"] }),
        foldEvent({ id: "m2", previous: "m1", spends: ["s2"] }),
        foldEvent({ id: "m3", previous: "m2", spends: ["s3"] }), // relay duplicate
      ],
    });
    expect(r.status).toBe("resolved");
    expect(r.chain.map((f) => f.id)).toEqual(["m3", "m2", "m1"]);
    expect(r.foldedSpendIds).toEqual(["s3", "s2", "s1"]);
    expect(r.warnings).toEqual([]);
  });

  it("is unresolved when the head is missing", () => {
    const r = resolveGameInventoryFoldChain({
      inventoryAddress: FARM,
      headFoldId: "m1",
      folds: [],
    });
    expect(r.status).toBe("unresolved");
    expect(r.problems).toEqual([
      {
        code: "missing-fold",
        foldId: "m1",
        message: expect.stringContaining("m1") as string,
      },
    ]);
  });

  it("is unresolved when a previous manifest is missing, keeping what was reachable", () => {
    const r = resolveGameInventoryFoldChain({
      inventoryAddress: FARM,
      headFoldId: "m2",
      folds: [foldEvent({ id: "m2", previous: "m1", spends: ["s2"] })],
    });
    expect(r.status).toBe("unresolved");
    expect(r.problems.map((p) => p.code)).toEqual(["missing-fold"]);
    expect(r.chain.map((f) => f.id)).toEqual(["m2"]);
    expect(r.foldedSpendIds).toEqual(["s2"]);
  });

  it("is unresolved on an invalid manifest", () => {
    const r = resolveGameInventoryFoldChain({
      inventoryAddress: FARM,
      headFoldId: "m1",
      folds: [makeEvent({ kind: 1417, id: "m1", pubkey: OWNER, tags: [] })],
    });
    expect(r.problems.map((p) => p.code)).toEqual(["invalid-fold"]);
  });

  it("is unresolved on a manifest authored by someone else", () => {
    const r = resolveGameInventoryFoldChain({
      inventoryAddress: FARM,
      headFoldId: "m1",
      folds: [foldEvent({ id: "m1", spends: ["s1"], pubkey: ATTACKER })],
    });
    expect(r.status).toBe("unresolved");
    expect(r.problems.map((p) => p.code)).toEqual(["invalid-fold"]);
    expect(r.problems[0]?.message).toContain("not the inventory owner");
  });

  it("is unresolved when the head is scoped to another inventory", () => {
    const r = resolveGameInventoryFoldChain({
      inventoryAddress: FARM,
      headFoldId: "m1",
      folds: [foldEvent({ id: "m1", inventory: ISLAND, spends: ["s1"] })],
    });
    expect(r.problems.map((p) => p.code)).toEqual(["wrong-inventory"]);
    expect(r.foldedSpendIds).toEqual([]);
  });

  it("is unresolved when a previous link crosses into another inventory", () => {
    const r = resolveGameInventoryFoldChain({
      inventoryAddress: FARM,
      headFoldId: "m2",
      folds: [
        foldEvent({ id: "m2", previous: "m1", spends: ["s2"] }),
        foldEvent({ id: "m1", inventory: ISLAND, spends: ["s1"] }),
      ],
    });
    expect(r.status).toBe("unresolved");
    expect(r.problems).toEqual([
      expect.objectContaining({ code: "wrong-inventory", foldId: "m1" }),
    ]);
  });

  it("terminates on a cycle", () => {
    const r = resolveGameInventoryFoldChain({
      inventoryAddress: FARM,
      headFoldId: "m2",
      folds: [
        foldEvent({ id: "m2", previous: "m1", spends: ["s2"] }),
        foldEvent({ id: "m1", previous: "m2", spends: ["s1"] }),
      ],
    });
    expect(r.status).toBe("unresolved");
    expect(r.problems.map((p) => p.code)).toEqual(["cycle"]);
    expect(r.chain.map((f) => f.id)).toEqual(["m2", "m1"]);
  });

  it("rejects a non-inventory address", () => {
    const r = resolveGameInventoryFoldChain({
      inventoryAddress: STRAWBERRY,
      headFoldId: "m1",
      folds: [],
    });
    expect(r.problems.map((p) => p.code)).toEqual(["wrong-inventory"]);
  });

  it("warns, without failing, when a spend is re-folded or contradicted across the chain", () => {
    const r = resolveGameInventoryFoldChain({
      inventoryAddress: FARM,
      headFoldId: "m2",
      folds: [
        foldEvent({ id: "m2", previous: "m1", spends: ["s1"], voids: ["s0"] }),
        foldEvent({ id: "m1", spends: ["s1", "s0"] }),
      ],
    });
    expect(r.status).toBe("resolved");
    expect(r.warnings.map((w) => w.code)).toEqual([
      "refolded-spend",
      "contradictory-spend",
    ]);
    // Each id is settled exactly once; the head (newest) manifest's
    // classification is the one kept.
    expect(r.foldedSpendIds).toEqual(["s1"]);
    expect(r.voidedSpendIds).toEqual(["s0"]);
    expect(r.settledSpendIds).toEqual(["s1", "s0"]);
  });

  describe("spend verification", () => {
    it("Example 7: a manifest referencing a spend against another inventory fails", () => {
      const r = resolveGameInventoryFoldChain({
        inventoryAddress: FARM,
        headFoldId: "m1",
        folds: [foldEvent({ id: "m1", spends: ["s1", "i1"] })],
        spends: [
          spendEvent({ id: "s1" }),
          spendEvent({ id: "i1", inventory: ISLAND }),
        ],
      });
      expect(r.status).toBe("unresolved");
      expect(r.problems).toEqual([
        expect.objectContaining({
          code: "foreign-spend",
          foldId: "m1",
          spendId: "i1",
        }),
      ]);
    });

    it("a manifest referencing a structurally invalid spend fails", () => {
      const r = resolveGameInventoryFoldChain({
        inventoryAddress: FARM,
        headFoldId: "m1",
        folds: [foldEvent({ id: "m1", spends: ["x1"] })],
        spends: [spendEvent({ id: "x1", pubkey: ATTACKER })],
      });
      expect(r.problems.map((p) => p.code)).toEqual(["invalid-spend"]);
    });

    it("a manifest voiding a foreign spend fails too", () => {
      const r = resolveGameInventoryFoldChain({
        inventoryAddress: FARM,
        headFoldId: "m1",
        folds: [foldEvent({ id: "m1", voids: ["i1"] })],
        spends: [spendEvent({ id: "i1", inventory: ISLAND })],
      });
      expect(r.problems.map((p) => p.code)).toEqual(["foreign-spend"]);
    });

    it("a referenced spend missing from the supplied set is only a warning", () => {
      const r = resolveGameInventoryFoldChain({
        inventoryAddress: FARM,
        headFoldId: "m1",
        folds: [foldEvent({ id: "m1", spends: ["s1", "s2"] })],
        spends: [spendEvent({ id: "s1" })],
      });
      expect(r.status).toBe("resolved");
      expect(r.warnings).toEqual([
        expect.objectContaining({ code: "unverified-spend", spendId: "s2" }),
      ]);
      expect(r.foldedSpendIds).toEqual(["s1", "s2"]);
    });

    it("verification is skipped when no spends are supplied", () => {
      const r = resolveGameInventoryFoldChain({
        inventoryAddress: FARM,
        headFoldId: "m1",
        folds: [foldEvent({ id: "m1", spends: ["s1"] })],
      });
      expect(r.warnings).toEqual([]);
    });
  });
});
