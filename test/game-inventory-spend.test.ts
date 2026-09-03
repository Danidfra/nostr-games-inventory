import { describe, it, expect } from "vitest";
import {
  KIND_GAME_INVENTORY_SPEND,
  SPEND_ITEM_MARKER,
  SPEND_QUANTITY_TAG,
  INVENTORY_MARKER,
  parseGameInventorySpend,
  parseGameInventorySpendResult,
  validateGameInventorySpend,
  buildGameInventorySpendEvent,
  buildGameInventorySpendFilter,
  compareGameInventorySpendOrder,
  sortGameInventorySpends,
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
} from "./spend-fixtures.js";

const INVENTORY_TAG = ["a", FARM, "", INVENTORY_MARKER];
const ITEM_TAG = ["a", STRAWBERRY, "", SPEND_ITEM_MARKER];
const QUANTITY_TAG = [SPEND_QUANTITY_TAG, "1"];

function event(
  tags: string[][],
  overrides: Partial<NostrEvent> = {},
): NostrEvent {
  return makeEvent({
    kind: KIND_GAME_INVENTORY_SPEND,
    pubkey: OWNER,
    id: "spend-1",
    tags,
    ...overrides,
  });
}

describe("constants", () => {
  it("registers kind 1416 and the tag vocabulary", () => {
    expect(KIND_GAME_INVENTORY_SPEND).toBe(1416);
    expect(INVENTORY_MARKER).toBe("inventory");
    expect(SPEND_ITEM_MARKER).toBe("item");
    expect(SPEND_QUANTITY_TAG).toBe("quantity");
  });
});

describe("parseGameInventorySpend", () => {
  it("parses a valid spend with full addresses and relay hints", () => {
    const result = parseGameInventorySpendResult(
      event([
        ["a", FARM, "wss://inv.example", INVENTORY_MARKER],
        ["a", STRAWBERRY, "wss://item.example", SPEND_ITEM_MARKER],
        [SPEND_QUANTITY_TAG, "3"],
      ]),
    );
    const { value, warnings } = expectOk(result);
    expect(warnings).toEqual([]);
    expect(value.id).toBe("spend-1");
    expect(value.kind).toBe(1416);
    expect(value.owner).toBe(OWNER);
    expect(value.createdAt).toBe(1_700_000_000);
    expect(value.inventoryAddress).toBe(FARM);
    expect(value.inventoryRelay).toBe("wss://inv.example");
    expect(value.itemAddress).toBe(STRAWBERRY);
    expect(value.itemRelay).toBe("wss://item.example");
    expect(value.quantity).toBe(3);
    expect(value.purpose).toBeUndefined();
    expect(value.content).toBe("");
    expect(value.contentJson).toBeUndefined();
  });

  it("never reduces the inventory or item identity to `d`", () => {
    const spend = parseGameInventorySpend(
      event([INVENTORY_TAG, ITEM_TAG, QUANTITY_TAG]),
    );
    expect(spend?.inventoryAddress).toBe("31633:owner:farm:main");
    expect(spend?.itemAddress).toBe("31632:issuer:farm:crop:strawberry");
  });

  it("rejects the wrong kind", () => {
    const result = parseGameInventorySpendResult(
      event([INVENTORY_TAG, ITEM_TAG, QUANTITY_TAG], { kind: 1 }),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects an event without an id", () => {
    const e = event([INVENTORY_TAG, ITEM_TAG, QUANTITY_TAG]);
    delete e.id;
    expect(parseGameInventorySpend(e)).toBeNull();
    const issues = validateGameInventorySpend(e).issues.map((i) => i.code);
    expect(issues).toEqual(["missing-event-id"]);
  });

  it("rejects a malformed inventory address", () => {
    for (const bad of ["farm:main", "31633:", "31633::farm", ":owner:farm"]) {
      const result = parseGameInventorySpendResult(
        event([["a", bad, "", INVENTORY_MARKER], ITEM_TAG, QUANTITY_TAG]),
      );
      expect(result.ok, bad).toBe(false);
    }
  });

  it("rejects a non-31633 inventory address", () => {
    const e = event([
      ["a", "31634:owner:farm:main", "", INVENTORY_MARKER],
      ITEM_TAG,
      QUANTITY_TAG,
    ]);
    expect(validateGameInventorySpend(e).issues.map((i) => i.code)).toEqual([
      "wrong-inventory-kind",
    ]);
  });

  it("rejects a malformed item address", () => {
    const e = event([
      INVENTORY_TAG,
      ["a", "strawberry", "", SPEND_ITEM_MARKER],
      QUANTITY_TAG,
    ]);
    expect(validateGameInventorySpend(e).issues.map((i) => i.code)).toEqual([
      "malformed-item-address",
    ]);
  });

  it("rejects a non-31632 item address", () => {
    const e = event([
      INVENTORY_TAG,
      ["a", "31633:issuer:farm:crop:strawberry", "", SPEND_ITEM_MARKER],
      QUANTITY_TAG,
    ]);
    expect(validateGameInventorySpend(e).issues.map((i) => i.code)).toEqual([
      "wrong-item-kind",
    ]);
  });

  it("rejects zero, negative, decimal and non-canonical quantities", () => {
    for (const bad of ["0", "-1", "1.5", "abc", "01", " 1", "1e3", ""]) {
      const e = event([INVENTORY_TAG, ITEM_TAG, [SPEND_QUANTITY_TAG, bad]]);
      expect(parseGameInventorySpend(e), bad).toBeNull();
      expect(validateGameInventorySpend(e).issues.map((i) => i.code)).toEqual([
        "invalid-quantity",
      ]);
    }
  });

  it("rejects missing required tags, one code per missing tag", () => {
    expect(
      validateGameInventorySpend(event([ITEM_TAG, QUANTITY_TAG])).issues.map(
        (i) => i.code,
      ),
    ).toEqual(["missing-inventory-reference"]);
    expect(
      validateGameInventorySpend(
        event([INVENTORY_TAG, QUANTITY_TAG]),
      ).issues.map((i) => i.code),
    ).toEqual(["missing-item-reference"]);
    expect(
      validateGameInventorySpend(event([INVENTORY_TAG, ITEM_TAG])).issues.map(
        (i) => i.code,
      ),
    ).toEqual(["missing-quantity"]);
  });

  it("rejects duplicate required tags rather than picking one", () => {
    expect(
      validateGameInventorySpend(
        event([INVENTORY_TAG, INVENTORY_TAG, ITEM_TAG, QUANTITY_TAG]),
      ).issues.map((i) => i.code),
    ).toEqual(["duplicate-inventory-reference"]);
    expect(
      validateGameInventorySpend(
        event([INVENTORY_TAG, ITEM_TAG, ITEM_TAG, QUANTITY_TAG]),
      ).issues.map((i) => i.code),
    ).toEqual(["duplicate-item-reference"]);
    expect(
      validateGameInventorySpend(
        event([
          INVENTORY_TAG,
          ITEM_TAG,
          QUANTITY_TAG,
          [SPEND_QUANTITY_TAG, "2"],
        ]),
      ).issues.map((i) => i.code),
    ).toEqual(["duplicate-quantity"]);
  });

  it("ignores unmarked and otherwise-marked `a` tags", () => {
    const e = event([
      ["a", ISLAND, "", "target"],
      ["a", "31632:issuer:other", ""],
      INVENTORY_TAG,
      ITEM_TAG,
      QUANTITY_TAG,
    ]);
    const spend = parseGameInventorySpend(e);
    expect(spend?.inventoryAddress).toBe(FARM);
    expect(spend?.itemAddress).toBe(STRAWBERRY);
  });

  it("rejects a spend whose author is not the inventory owner", () => {
    const e = event([INVENTORY_TAG, ITEM_TAG, QUANTITY_TAG], {
      pubkey: ATTACKER,
    });
    const result = parseGameInventorySpendResult(e);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("not the inventory owner");
    }
    expect(validateGameInventorySpend(e).issues.map((i) => i.code)).toEqual([
      "author-mismatch",
    ]);
  });

  it("a `client` tag does not authorize a spend by a non-owner", () => {
    const e = event(
      [INVENTORY_TAG, ITEM_TAG, QUANTITY_TAG, ["client", "farm"]],
      { pubkey: ATTACKER },
    );
    expect(parseGameInventorySpend(e)).toBeNull();
  });

  it("preserves optional metadata and warns on blank values", () => {
    const { value, warnings } = expectOk(
      parseGameInventorySpendResult(
        event(
          [
            INVENTORY_TAG,
            ITEM_TAG,
            QUANTITY_TAG,
            ["purpose", "feed:blobbi"],
            ["client", "blobbi-island", "31990:app:blobbi", "wss://r"],
            ["nonce", "abc"],
            ["alt", "Spent 1 strawberry"],
            ["unknown", "kept-on-event"],
          ],
          { content: '{"note":"hi"}' },
        ),
      ),
    );
    expect(warnings).toEqual([]);
    expect(value.purpose).toBe("feed:blobbi");
    expect(value.client).toBe("blobbi-island");
    expect(value.nonce).toBe("abc");
    expect(value.alt).toBe("Spent 1 strawberry");
    expect(value.contentJson).toEqual({ note: "hi" });
    expect(value.event.tags).toContainEqual(["unknown", "kept-on-event"]);

    const blank = expectOk(
      parseGameInventorySpendResult(
        event([INVENTORY_TAG, ITEM_TAG, QUANTITY_TAG, ["purpose", "  "]]),
      ),
    );
    expect(blank.value.purpose).toBeUndefined();
    expect(blank.warnings.map((w) => w.code)).toEqual(["invalid-metadata-tag"]);
  });

  it("invalid JSON content warns in permissive mode and rejects in strict", () => {
    const e = event([INVENTORY_TAG, ITEM_TAG, QUANTITY_TAG], {
      content: "{oops",
    });
    const permissive = expectOk(parseGameInventorySpendResult(e));
    expect(permissive.warnings.map((w) => w.code)).toEqual([
      "invalid-json-content",
    ]);
    expect(parseGameInventorySpendResult(e, { mode: "strict" }).ok).toBe(false);
  });

  it("honours requireHexPubkey and requireHexEventId", () => {
    const e = event([INVENTORY_TAG, ITEM_TAG, QUANTITY_TAG]);
    expect(parseGameInventorySpend(e)).not.toBeNull();
    expect(parseGameInventorySpend(e, { requireHexPubkey: true })).toBeNull();
    expect(parseGameInventorySpend(e, { requireHexEventId: true })).toBeNull();
  });
});

describe("buildGameInventorySpendEvent", () => {
  it("emits the fixed tag order and never an id or sig", () => {
    const template = buildGameInventorySpendEvent({
      inventoryAddress: FARM,
      inventoryRelay: "wss://inv",
      itemAddress: STRAWBERRY,
      itemRelay: "wss://item",
      quantity: 2,
      purpose: "feed",
      client: "blobbi",
      nonce: "n1",
      alt: "Spend",
      extraTags: [["x", "y"]],
    });
    expect(template).toEqual({
      kind: 1416,
      content: "",
      tags: [
        ["a", FARM, "wss://inv", "inventory"],
        ["a", STRAWBERRY, "wss://item", "item"],
        ["quantity", "2"],
        ["purpose", "feed"],
        ["client", "blobbi"],
        ["nonce", "n1"],
        ["alt", "Spend"],
        ["x", "y"],
      ],
    });
    expect("id" in template).toBe(false);
    expect("sig" in template).toBe(false);
  });

  it("omits blank metadata and defaults relays to empty strings", () => {
    const template = buildGameInventorySpendEvent({
      inventoryAddress: FARM,
      itemAddress: STRAWBERRY,
      quantity: 1,
      purpose: "  ",
    });
    expect(template.tags).toEqual([
      ["a", FARM, "", "inventory"],
      ["a", STRAWBERRY, "", "item"],
      ["quantity", "1"],
    ]);
  });

  it("requires full addresses of the right kinds", () => {
    expect(() =>
      buildGameInventorySpendEvent({
        inventoryAddress: "farm:main",
        itemAddress: STRAWBERRY,
        quantity: 1,
      }),
    ).toThrow(/inventoryAddress/);
    expect(() =>
      buildGameInventorySpendEvent({
        inventoryAddress: STRAWBERRY,
        itemAddress: STRAWBERRY,
        quantity: 1,
      }),
    ).toThrow(/inventoryAddress/);
    expect(() =>
      buildGameInventorySpendEvent({
        inventoryAddress: FARM,
        itemAddress: FARM,
        quantity: 1,
      }),
    ).toThrow(/itemAddress/);
  });

  it("rejects every non-positive-integer quantity without coercion", () => {
    for (const bad of [
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      2 ** 53,
    ]) {
      expect(() =>
        buildGameInventorySpendEvent({
          inventoryAddress: FARM,
          itemAddress: STRAWBERRY,
          quantity: bad,
        }),
      ).toThrow(/quantity/);
    }
  });

  it("rejects extraTags that collide with managed tags", () => {
    for (const tag of [
      ["a", ISLAND, "", "inventory"],
      ["quantity", "5"],
      ["purpose", "x"],
      ["alt", "x"],
    ]) {
      expect(() =>
        buildGameInventorySpendEvent({
          inventoryAddress: FARM,
          itemAddress: STRAWBERRY,
          quantity: 1,
          extraTags: [tag],
        }),
      ).toThrow(/extraTags/);
    }
  });

  it("round-trips through the parser", () => {
    const template = buildGameInventorySpendEvent({
      inventoryAddress: FARM,
      itemAddress: STRAWBERRY,
      quantity: 7,
      purpose: "craft",
      content: { note: "x" },
    });
    const spend = parseGameInventorySpend(
      makeEvent({ ...template, id: "s", pubkey: OWNER }),
    );
    expect(spend).not.toBeNull();
    expect(spend?.inventoryAddress).toBe(FARM);
    expect(spend?.itemAddress).toBe(STRAWBERRY);
    expect(spend?.quantity).toBe(7);
    expect(spend?.purpose).toBe("craft");
    expect(spend?.contentJson).toEqual({ note: "x" });
  });
});

describe("compareGameInventorySpendOrder", () => {
  it("orders by created_at first", () => {
    expect(
      compareGameInventorySpendOrder(
        { createdAt: 1, id: "zzz" },
        { createdAt: 2, id: "aaa" },
      ),
    ).toBeLessThan(0);
    expect(
      compareGameInventorySpendOrder(
        { createdAt: 2, id: "aaa" },
        { createdAt: 1, id: "zzz" },
      ),
    ).toBeGreaterThan(0);
  });

  it("breaks equal created_at ties by lowest id", () => {
    expect(
      compareGameInventorySpendOrder(
        { createdAt: 1, id: "a" },
        { createdAt: 1, id: "b" },
      ),
    ).toBeLessThan(0);
    expect(
      compareGameInventorySpendOrder(
        { createdAt: 1, id: "b" },
        { createdAt: 1, id: "a" },
      ),
    ).toBeGreaterThan(0);
    expect(
      compareGameInventorySpendOrder(
        { createdAt: 1, id: "a" },
        { createdAt: 1, id: "a" },
      ),
    ).toBe(0);
  });

  it("sorting is independent of input order and does not mutate", () => {
    const a = { createdAt: 5, id: "a" };
    const b = { createdAt: 5, id: "b" };
    const c = { createdAt: 3, id: "z" };
    const input = [b, a, c];
    const sorted = sortGameInventorySpends(input);
    expect(sorted).toEqual([c, a, b]);
    expect(sortGameInventorySpends([a, c, b])).toEqual([c, a, b]);
    expect(input).toEqual([b, a, c]);
  });

  it("orders parsed spends", () => {
    const s1 = parseGameInventorySpend(spendEvent({ id: "b", createdAt: 10 }));
    const s2 = parseGameInventorySpend(spendEvent({ id: "a", createdAt: 10 }));
    const s3 = parseGameInventorySpend(spendEvent({ id: "c", createdAt: 9 }));
    if (!s1 || !s2 || !s3) throw new Error("fixture");
    expect(sortGameInventorySpends([s1, s2, s3]).map((s) => s.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });
});

describe("buildGameInventorySpendFilter", () => {
  it("builds the usual per-inventory query", () => {
    expect(
      buildGameInventorySpendFilter({
        authors: [OWNER],
        inventoryAddresses: [FARM],
      }),
    ).toEqual({ kinds: [1416], authors: [OWNER], "#a": [FARM] });
  });

  it("supports ids and merges inventory and item addresses into #a", () => {
    expect(
      buildGameInventorySpendFilter({
        ids: ["x", "x", " "],
        inventoryAddresses: [FARM, FARM],
        itemAddresses: [STRAWBERRY],
      }),
    ).toEqual({ kinds: [1416], ids: ["x"], "#a": [FARM, STRAWBERRY] });
  });

  it("omits empty fields and has no `since`", () => {
    const filter = buildGameInventorySpendFilter({ authors: ["", " "] });
    expect(filter).toEqual({ kinds: [1416] });
    expect("since" in filter).toBe(false);
  });
});
