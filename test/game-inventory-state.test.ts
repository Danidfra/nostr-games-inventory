import { describe, it, expect } from "vitest";
import {
  resolveGameInventoryState,
  parseGameInventory,
  parseGameInventoryResult,
  buildGameInventoryEvent,
  toBuildGameInventoryInput,
  toBuildGameInventoryFoldInput,
  buildGameInventoryFoldEvent,
  addInventoryItemQuantity,
  compareGameInventoryRevisions,
  INVENTORY_FOLD_MARKER,
  KIND_GAME_INVENTORY,
  type NostrEvent,
} from "../src/index.js";
import { makeEvent, expectOk } from "./helpers.js";
import {
  OWNER,
  FARM,
  ISLAND,
  STRAWBERRY,
  CARROT,
  spendEvent,
  foldEvent,
  snapshot,
  quantityOf,
} from "./spend-fixtures.js";

function inventoryEvent(tags: string[][]): NostrEvent {
  return makeEvent({ kind: KIND_GAME_INVENTORY, pubkey: OWNER, tags });
}

describe("kind:31633 fold reference", () => {
  it("an inventory with no fold reference parses exactly as before", () => {
    const inventory = parseGameInventory(
      inventoryEvent([
        ["d", "farm:main"],
        ["a", STRAWBERRY, "", "3"],
      ]),
    );
    expect(inventory?.fold).toBeUndefined();
    expect("fold" in (inventory ?? {})).toBe(false);
    expect(quantityOf(inventory as never, STRAWBERRY)).toBe(3);
  });

  it("parses the fold reference with its relay hint", () => {
    const { value, warnings } = expectOk(
      parseGameInventoryResult(
        inventoryEvent([
          ["d", "farm:main"],
          ["e", "m1", "wss://f", INVENTORY_FOLD_MARKER],
          ["e", "g1", "", "grant"],
        ]),
      ),
    );
    expect(warnings).toEqual([]);
    expect(value.fold).toEqual({ eventId: "m1", relay: "wss://f" });
    expect(value.grantEventIds).toEqual(["g1"]);
  });

  it("ignores a blank fold reference with a warning", () => {
    const { value, warnings } = expectOk(
      parseGameInventoryResult(
        inventoryEvent([
          ["d", "farm:main"],
          ["e", "", "", INVENTORY_FOLD_MARKER],
        ]),
      ),
    );
    expect(value.fold).toBeUndefined();
    expect(warnings.map((w) => w.code)).toEqual(["invalid-fold-tag"]);
  });

  it("keeps the first of duplicate fold references in permissive mode and rejects in strict", () => {
    const e = inventoryEvent([
      ["d", "farm:main"],
      ["e", "m1", "", INVENTORY_FOLD_MARKER],
      ["e", "m2", "", INVENTORY_FOLD_MARKER],
    ]);
    const { value, warnings } = expectOk(parseGameInventoryResult(e));
    expect(value.fold?.eventId).toBe("m1");
    expect(warnings.map((w) => w.code)).toEqual(["duplicate-fold-reference"]);
    expect(parseGameInventoryResult(e, { mode: "strict" }).ok).toBe(false);
  });

  it("honours requireHexEventId on the fold reference", () => {
    const { value, warnings } = expectOk(
      parseGameInventoryResult(
        inventoryEvent([
          ["d", "farm:main"],
          ["e", "m1", "", INVENTORY_FOLD_MARKER],
        ]),
        { requireHexEventId: true },
      ),
    );
    expect(value.fold).toBeUndefined();
    expect(warnings.map((w) => w.code)).toEqual(["invalid-fold-tag"]);
  });

  it("builder emits the fold tag after grants and before alt", () => {
    const template = buildGameInventoryEvent({
      id: "farm:main",
      items: [{ address: STRAWBERRY, quantity: 1 }],
      grants: [{ eventId: "g1" }],
      fold: { eventId: "m1", relay: "wss://f" },
      alt: "alt",
    });
    expect(template.tags).toEqual([
      ["d", "farm:main"],
      ["a", STRAWBERRY, "", "1"],
      ["e", "g1", "", "grant"],
      ["e", "m1", "wss://f", "fold"],
      ["alt", "alt"],
    ]);
  });

  it("builder rejects a blank fold id and a fold tag in extraTags", () => {
    expect(() =>
      buildGameInventoryEvent({ id: "x", fold: { eventId: " " } }),
    ).toThrow(/fold/);
    expect(() =>
      buildGameInventoryEvent({
        id: "x",
        extraTags: [["e", "m1", "", INVENTORY_FOLD_MARKER]],
      }),
    ).toThrow(/fold/);
    // Other e tags still pass through.
    expect(() =>
      buildGameInventoryEvent({
        id: "x",
        extraTags: [["e", "m1", "", "reply"]],
      }),
    ).not.toThrow();
  });

  it("round-trips the fold reference and strips the stale tag from preserveTags", () => {
    const base = snapshot({
      items: { [STRAWBERRY]: 2 },
      fold: "m1",
      extraTags: [["u", "v"]],
    });
    const rebuilt = buildGameInventoryEvent(toBuildGameInventoryInput(base));
    expect(rebuilt.tags.filter((t) => t[3] === INVENTORY_FOLD_MARKER)).toEqual([
      ["e", "m1", "", "fold"],
    ]);
    expect(rebuilt.tags).toContainEqual(["u", "v"]);

    // Overriding the fold replaces it rather than duplicating it.
    const next = buildGameInventoryEvent({
      ...toBuildGameInventoryInput(base),
      fold: { eventId: "m2" },
    });
    expect(next.tags.filter((t) => t[0] === "e")).toEqual([
      ["e", "m2", "", "fold"],
    ]);
  });
});

describe("resolveGameInventoryState", () => {
  it("Example 1 (legacy snapshot): no fold reference, spends pending", () => {
    const r = resolveGameInventoryState({
      inventory: snapshot({ items: { [STRAWBERRY]: 3 } }),
      folds: [],
      spends: [spendEvent({ id: "s1" })],
    });
    expect(r.status).toBe("resolved");
    if (r.status !== "resolved") return;
    expect(r.chain.chain).toEqual([]);
    expect(quantityOf(r.state.inventory, STRAWBERRY)).toBe(2);
  });

  it("Example 2: folded spends are never subtracted twice", () => {
    const s1 = spendEvent({ id: "s1", createdAt: 1 });
    const s2 = spendEvent({ id: "s2", createdAt: 2 });
    const m1 = foldEvent({ id: "m1", spends: ["s1", "s2"] });
    const r = resolveGameInventoryState({
      inventory: snapshot({ items: { [STRAWBERRY]: 1 }, fold: "m1" }),
      folds: [m1],
      spends: [s1, s2],
    });
    expect(r.status).toBe("resolved");
    if (r.status !== "resolved") return;
    expect(quantityOf(r.state.inventory, STRAWBERRY)).toBe(1);
    expect(r.state.folded.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(r.state.applied).toEqual([]);
  });

  it("Example 3: a later spend after the fold is pending", () => {
    const r = resolveGameInventoryState({
      inventory: snapshot({ items: { [STRAWBERRY]: 1 }, fold: "m1" }),
      folds: [foldEvent({ id: "m1", spends: ["s1", "s2"] })],
      spends: [
        spendEvent({ id: "s1", createdAt: 1 }),
        spendEvent({ id: "s2", createdAt: 2 }),
        spendEvent({ id: "s3", createdAt: 3 }),
      ],
    });
    if (r.status !== "resolved") throw new Error("unresolved");
    expect(quantityOf(r.state.inventory, STRAWBERRY)).toBe(0);
    expect(r.state.applied.map((s) => s.id)).toEqual(["s3"]);
  });

  it("Example 4: a late spend older than the fold is still pending", () => {
    // M1 was built having seen s1 and s3. s2, created between them, arrives
    // later. It is not reachable from M1, so it is pending — its created_at
    // being older than the fold and the snapshot is irrelevant.
    const r = resolveGameInventoryState({
      inventory: snapshot({ items: { [STRAWBERRY]: 3 }, fold: "m1" }),
      folds: [foldEvent({ id: "m1", createdAt: 100, spends: ["s1", "s3"] })],
      spends: [
        spendEvent({ id: "s1", createdAt: 10 }),
        spendEvent({ id: "s3", createdAt: 30 }),
        spendEvent({ id: "s2", createdAt: 20 }),
      ],
    });
    if (r.status !== "resolved") throw new Error("unresolved");
    expect(r.state.applied.map((s) => s.id)).toEqual(["s2"]);
    expect(quantityOf(r.state.inventory, STRAWBERRY)).toBe(2);
  });

  it("Example 8: a snapshot referencing a manifest that cannot be retrieved is unresolved", () => {
    const r = resolveGameInventoryState({
      inventory: snapshot({ items: { [STRAWBERRY]: 3 }, fold: "m1" }),
      folds: [],
      spends: [spendEvent({ id: "s1" })],
    });
    expect(r.status).toBe("unresolved");
    expect("state" in r).toBe(false);
    expect(r.chain.problems.map((p) => p.code)).toEqual(["missing-fold"]);
  });

  it("Example 9: an orphan manifest has no effect", () => {
    const r = resolveGameInventoryState({
      inventory: snapshot({ items: { [STRAWBERRY]: 3 } }),
      folds: [foldEvent({ id: "m2", spends: ["s1"] })],
      spends: [spendEvent({ id: "s1" })],
    });
    if (r.status !== "resolved") throw new Error("unresolved");
    expect(r.chain.chain).toEqual([]);
    expect(r.state.applied.map((s) => s.id)).toEqual(["s1"]);
    expect(quantityOf(r.state.inventory, STRAWBERRY)).toBe(2);
  });

  it("voided spends stay void against a later, larger balance", () => {
    // s2 overdrew and was voided by m1. The next snapshot holds more, but the
    // void is explicit, so s2 never applies.
    const r = resolveGameInventoryState({
      inventory: snapshot({ items: { [STRAWBERRY]: 10 }, fold: "m1" }),
      folds: [foldEvent({ id: "m1", spends: ["s1"], voids: ["s2"] })],
      spends: [
        spendEvent({ id: "s1", createdAt: 1 }),
        spendEvent({ id: "s2", createdAt: 2, quantity: 5 }),
      ],
    });
    if (r.status !== "resolved") throw new Error("unresolved");
    expect(quantityOf(r.state.inventory, STRAWBERRY)).toBe(10);
    expect(r.state.voided.map((s) => s.id)).toEqual(["s2"]);
  });

  it("a chain crossing inventories is unresolved and produces no state", () => {
    const r = resolveGameInventoryState({
      inventory: snapshot({ items: { [STRAWBERRY]: 3 }, fold: "m2" }),
      folds: [
        foldEvent({ id: "m2", previous: "m1", spends: ["s2"] }),
        foldEvent({ id: "m1", inventory: ISLAND, spends: ["s1"] }),
      ],
      spends: [],
    });
    expect(r.status).toBe("unresolved");
  });

  it("verifies referenced spends by default and can be told not to", () => {
    const input = {
      inventory: snapshot({ items: { [STRAWBERRY]: 3 }, fold: "m1" }),
      folds: [foldEvent({ id: "m1", spends: ["i1"] })],
      spends: [spendEvent({ id: "i1", inventory: ISLAND })],
    };
    expect(resolveGameInventoryState(input).status).toBe("unresolved");
    expect(
      resolveGameInventoryState(input, { verifySpends: false }).status,
    ).toBe("resolved");
  });

  it("the raw snapshot is never double-debited across a multi-manifest chain", () => {
    const spends = [
      spendEvent({ id: "s1", createdAt: 1 }),
      spendEvent({ id: "s2", createdAt: 2 }),
      spendEvent({ id: "s3", createdAt: 3 }),
      spendEvent({ id: "s4", createdAt: 4 }),
    ];
    const r = resolveGameInventoryState({
      inventory: snapshot({ items: { [STRAWBERRY]: 7 }, fold: "m2" }),
      folds: [
        foldEvent({ id: "m1", spends: ["s1", "s2"] }),
        foldEvent({ id: "m2", previous: "m1", spends: ["s3"] }),
      ],
      spends,
    });
    if (r.status !== "resolved") throw new Error("unresolved");
    expect(r.chain.foldedSpendIds).toEqual(["s3", "s1", "s2"]);
    expect(r.state.folded.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
    expect(r.state.applied.map((s) => s.id)).toEqual(["s4"]);
    expect(quantityOf(r.state.inventory, STRAWBERRY)).toBe(6);
  });
});

describe("the owner's fold-and-publish cycle", () => {
  it("derives, folds, mutates, and publishes a snapshot that reads back consistently", () => {
    // Base: 3 strawberries, no fold yet. Blobbi spent 1 twice; one overdraw
    // of 5 was also attempted.
    const base = snapshot({ items: { [STRAWBERRY]: 3 }, revision: 4 });
    const spends = [
      spendEvent({ id: "s1", createdAt: 1 }),
      spendEvent({ id: "s2", createdAt: 2 }),
      spendEvent({ id: "s3", createdAt: 3, quantity: 5 }),
    ];

    // 1–4. Read snapshot, resolve chain, derive.
    const r = resolveGameInventoryState({ inventory: base, folds: [], spends });
    if (r.status !== "resolved") throw new Error("unresolved");
    expect(quantityOf(r.state.inventory, STRAWBERRY)).toBe(1);

    // 5. Farm's own mutation: harvest 2 carrots.
    const next = addInventoryItemQuantity(r.state.inventory, CARROT, 2);

    // 6–7. Manifest for the newly settled spends, chained to the base fold.
    const foldInput = toBuildGameInventoryFoldInput(r.state);
    expect(foldInput).not.toBeNull();
    const foldTemplate = buildGameInventoryFoldEvent(foldInput as never);
    expect(foldTemplate.tags).toEqual([
      ["a", FARM, "", "inventory"],
      ["e", "s1", "", "spend"],
      ["e", "s2", "", "spend"],
      ["e", "s3", "", "void"],
    ]);
    const m1 = makeEvent({ ...foldTemplate, id: "m1", pubkey: OWNER });

    // 8–9. Publish the manifest, then the snapshot referencing it.
    const snapshotTemplate = buildGameInventoryEvent({
      ...toBuildGameInventoryInput(next),
      fold: { eventId: "m1" },
      revision: (next.revision ?? 0) + 1,
    });
    expect(snapshotTemplate.tags).toEqual([
      ["d", "farm:main"],
      ["revision", "5"],
      ["a", STRAWBERRY, "", "1"],
      ["a", CARROT, "", "2"],
      ["e", "m1", "", "fold"],
    ]);
    const published = parseGameInventory(
      makeEvent({ ...snapshotTemplate, id: "snapshot-2", pubkey: OWNER }),
    );
    if (published === null) throw new Error("did not parse");
    expect(compareGameInventoryRevisions(base, published)).toBe("ahead");

    // A reader with the same events sees no pending spends and the new state.
    const read = resolveGameInventoryState({
      inventory: published,
      folds: [m1],
      spends,
    });
    if (read.status !== "resolved") throw new Error("unresolved");
    expect(quantityOf(read.state.inventory, STRAWBERRY)).toBe(1);
    expect(quantityOf(read.state.inventory, CARROT)).toBe(2);
    expect(read.state.applied).toEqual([]);
    expect(read.state.folded.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(read.state.voided.map((s) => s.id)).toEqual(["s3"]);

    // A rewrite that folds nothing new keeps the fold reference.
    const again = resolveGameInventoryState({
      inventory: published,
      folds: [m1],
      spends,
    });
    if (again.status !== "resolved") throw new Error("unresolved");
    expect(toBuildGameInventoryFoldInput(again.state)).toBeNull();
    const rewrite = buildGameInventoryEvent(
      toBuildGameInventoryInput(again.state.inventory),
    );
    expect(rewrite.tags).toContainEqual(["e", "m1", "", "fold"]);
  });
});
