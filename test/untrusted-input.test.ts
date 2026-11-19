import { describe, it, expect } from "vitest";
import {
  parseGameItemPlacementResult,
  validateGameItemPlacement,
  toBuildGameItemPlacementInput,
  buildGameItemPlacementEvent,
  parseGameItemDefinitionResult,
  parseGameInventoryResult,
  parseGameInventorySpendResult,
  parseGameInventoryFoldResult,
  deriveGameInventoryState,
  resolveGameInventoryFoldChain,
  filterEventsByPlacementItemAddress,
  validateGameInventorySpend,
  validateGameInventoryFold,
  KIND_GAME_ITEM_PLACEMENT,
  type NostrEvent,
} from "../src/index.js";
import {
  cloneJsonLike,
  MAX_JSON_NESTING_DEPTH,
} from "../src/common/objects.js";
import { makeEvent, expectOk } from "./helpers.js";
import {
  FARM,
  OWNER,
  STRAWBERRY,
  foldEvent,
  snapshot,
  spendEvent,
} from "./spend-fixtures.js";

/**
 * Adversarial input: values a hostile publisher can sign and relay. Every
 * parse here must return a structured result, never throw.
 */

const CARROT = "31632:pubkey123:blobbi:food:carrot";

function placementEvent(content: string): NostrEvent {
  return makeEvent({
    kind: KIND_GAME_ITEM_PLACEMENT,
    pubkey: "author1",
    tags: [
      ["d", "room"],
      ["a", CARROT, "", "item"],
    ],
    content,
  });
}

/** JSON text for `levels` nested arrays: `[[[ ... ]]]`. */
function nestedArrays(levels: number): string {
  return "[".repeat(levels) + "]".repeat(levels);
}

/** Entry JSON whose unknown `extra` field nests `levels` arrays. */
function entryWithNesting(levels: number): string {
  return `{"id":"p1","item":"${CARROT}","mode":"place","extra":${nestedArrays(levels)}}`;
}

describe("deeply nested placement content (I1)", () => {
  it("accepts content exactly at the nesting limit", () => {
    // content object (1) + placements array (2) + entry (3) + extra.
    const extraLevels = MAX_JSON_NESTING_DEPTH - 3;
    const event = placementEvent(
      `{"placements":[${entryWithNesting(extraLevels)}]}`,
    );
    expect(validateGameItemPlacement(event).valid).toBe(true);
    const result = expectOk(
      parseGameItemPlacementResult(event, { mode: "strict" }),
    );
    expect(result.value.placements).toHaveLength(1);
    // The copy is walkable by recursive consumer code.
    expect(() => JSON.stringify(result.value.placements)).not.toThrow();
  });

  it("rejects content one level over the limit, without throwing", () => {
    const extraLevels = MAX_JSON_NESTING_DEPTH - 2;
    const event = placementEvent(
      `{"placements":[${entryWithNesting(extraLevels)}]}`,
    );
    const validation = validateGameItemPlacement(event);
    expect(validation.valid).toBe(false);
    expect(validation.issues.map((i) => i.code)).toEqual(["content-too-deep"]);
    const result = parseGameItemPlacementResult(event);
    expect(result.ok).toBe(false);
  });

  it.each([1_800, 5_000, 100_000])(
    "returns ok:false for an entry nested %i levels deep",
    (levels) => {
      const event = placementEvent(
        `{"placements":[${entryWithNesting(levels)}]}`,
      );
      for (const mode of ["permissive", "strict"] as const) {
        let result: ReturnType<typeof parseGameItemPlacementResult> | undefined;
        expect(() => {
          result = parseGameItemPlacementResult(event, { mode });
        }).not.toThrow();
        expect(result?.ok).toBe(false);
      }
    },
  );

  it("rejects deep nesting in an unknown top-level field and in target/reference", () => {
    const deep = nestedArrays(5_000);
    for (const content of [
      `{"placements":[],"ext":${deep}}`,
      `{"placements":[],"target":{"type":"future","x":${deep}}}`,
      `{"placements":[],"reference":{"space":"future","x":${deep}}}`,
    ]) {
      const result = parseGameItemPlacementResult(placementEvent(content));
      expect(result.ok).toBe(false);
    }
  });

  it("builders reject a deep caller entry with a clear error, not a RangeError", () => {
    let entry: unknown = { leaf: true };
    for (let i = 0; i < 5_000; i++) {
      entry = { next: entry };
    }
    expect(() =>
      buildGameItemPlacementEvent({
        id: "room",
        placements: [
          {
            id: "p1",
            item: CARROT,
            mode: "place",
            extra: entry,
          },
        ],
      }),
    ).toThrow(/nested deeper than 64 levels/);
  });

  it("round-trips content at the limit through toBuild and build", () => {
    const extraLevels = MAX_JSON_NESTING_DEPTH - 3;
    const event = placementEvent(
      `{"placements":[${entryWithNesting(extraLevels)}],"ext":${nestedArrays(MAX_JSON_NESTING_DEPTH - 1)}}`,
    );
    const placement = expectOk(parseGameItemPlacementResult(event)).value;
    const rebuilt = buildGameItemPlacementEvent(
      toBuildGameItemPlacementInput(placement),
    );
    expect(JSON.parse(rebuilt.content)).toEqual(JSON.parse(event.content));
  });
});

describe("cloneJsonLike", () => {
  it("copies deep values without using the call stack", () => {
    let value: unknown = 1;
    for (let i = 0; i < 9_000; i++) {
      value = [value];
    }
    const copy = cloneJsonLike(value);
    // Plain comparisons: vitest matchers walk values recursively.
    let a: unknown = copy;
    let b: unknown = value;
    let shared = 0;
    for (let i = 0; i < 9_000; i++) {
      if (a === b) {
        shared++;
      }
      a = (a as unknown[])[0];
      b = (b as unknown[])[0];
    }
    expect(shared).toBe(0);
    expect(a).toBe(1);
  });

  it("throws a plain Error for a cyclic value instead of looping", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    expect(() => cloneJsonLike(cyclic)).toThrow(/cyclic/);
  });

  it("preserves array order, nested objects and scalars", () => {
    const value = { a: [1, "two", null, { b: [true, false] }], c: { d: {} } };
    const copy = cloneJsonLike(value);
    expect(copy).toEqual(value);
    expect(copy.a).not.toBe(value.a);
    expect(copy.c.d).not.toBe(value.c.d);
  });
});

describe("__proto__ and other prototype-related keys (I2)", () => {
  const protoEntry = `{"id":"p1","item":"${CARROT}","mode":"place","__proto__":{"layer":"NOT-A-NUMBER","slot":"","position":{"x":"evil"}}}`;
  const goodEntry = `{"id":"p2","item":"${CARROT}","mode":"place","layer":2}`;

  function assertPrototypeUntouched(): void {
    const probe: Record<string, unknown> = {};
    expect(probe["layer"]).toBeUndefined();
    expect(probe["slot"]).toBeUndefined();
    expect(probe["position"]).toBeUndefined();
    expect(Object.getOwnPropertyNames(Object.prototype)).not.toContain("layer");
  }

  it("drops an entry with a top-level __proto__ key in permissive mode", () => {
    const result = expectOk(
      parseGameItemPlacementResult(
        placementEvent(`{"placements":[${protoEntry},${goodEntry}]}`),
      ),
    );
    expect(result.value.placements.map((e) => e.id)).toEqual(["p2"]);
    expect(result.warnings.map((w) => w.code)).toContain(
      "invalid-placement-entry",
    );
    // The surviving entry has an ordinary prototype and only own fields.
    const entry = result.value.placements[0];
    expect(Object.getPrototypeOf(entry)).toBe(Object.prototype);
    expect(entry?.layer).toBe(2);
    assertPrototypeUntouched();
  });

  it("rejects the event in strict mode", () => {
    const result = parseGameItemPlacementResult(
      placementEvent(`{"placements":[${protoEntry}]}`),
      { mode: "strict" },
    );
    expect(result.ok).toBe(false);
    assertPrototypeUntouched();
  });

  it("rejects __proto__ nested inside an entry field", () => {
    const nested = `{"id":"p1","item":"${CARROT}","mode":"place","position":{"x":1,"y":2,"__proto__":{"z":"evil"}}}`;
    const result = expectOk(
      parseGameItemPlacementResult(
        placementEvent(`{"placements":[${nested}]}`),
      ),
    );
    expect(result.value.placements).toEqual([]);
    const deeper = `{"id":"p1","item":"${CARROT}","mode":"place","metadata":{"a":[{"b":{"__proto__":{}}}]}}`;
    expect(
      parseGameItemPlacementResult(
        placementEvent(`{"placements":[${deeper}]}`),
        { mode: "strict" },
      ).ok,
    ).toBe(false);
    assertPrototypeUntouched();
  });

  it("rejects a target with a __proto__ key and drops such a reference", () => {
    const target = parseGameItemPlacementResult(
      placementEvent(
        `{"placements":[],"target":{"type":"internal","__proto__":{"id":"x"}}}`,
      ),
    );
    expect(target.ok).toBe(false);

    const reference = expectOk(
      parseGameItemPlacementResult(
        placementEvent(
          `{"placements":[],"reference":{"space":"future","__proto__":{"space":"2d"}}}`,
        ),
      ),
    );
    expect(reference.value.reference).toBeUndefined();
    expect(reference.warnings.map((w) => w.code)).toContain(
      "invalid-reference",
    );
    assertPrototypeUntouched();
  });

  it("keeps a top-level __proto__ field as own data through a round trip", () => {
    const event = placementEvent(
      `{"placements":[${goodEntry}],"__proto__":{"placements":"evil"}}`,
    );
    const placement = expectOk(parseGameItemPlacementResult(event)).value;
    expect(placement.placements.map((e) => e.id)).toEqual(["p2"]);

    const input = toBuildGameItemPlacementInput(placement);
    const extra = input.contentExtra as Record<string, unknown>;
    expect(Object.getPrototypeOf(extra)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(extra, "__proto__")).toBe(true);
    const rebuilt = buildGameItemPlacementEvent(input);
    expect(rebuilt.content).toContain('"__proto__":{"placements":"evil"}');
    assertPrototypeUntouched();
  });

  it("treats constructor and prototype as ordinary preserved keys", () => {
    const entry = `{"id":"p1","item":"${CARROT}","mode":"place","constructor":{"name":"x"},"prototype":{"layer":"y"}}`;
    const result = expectOk(
      parseGameItemPlacementResult(
        placementEvent(`{"placements":[${entry}]}`),
        {
          mode: "strict",
        },
      ),
    );
    const parsed = result.value.placements[0] as Record<string, unknown>;
    expect(parsed["constructor"]).toEqual({ name: "x" });
    expect(parsed["prototype"]).toEqual({ layer: "y" });
    expect(parsed["layer"]).toBeUndefined();
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    assertPrototypeUntouched();
  });

  it("cloneJsonLike never changes a prototype", () => {
    const source = JSON.parse('{"a":{"__proto__":{"polluted":true}}}') as {
      a: Record<string, unknown>;
    };
    const copy = cloneJsonLike(source);
    expect(Object.getPrototypeOf(copy.a)).toBe(Object.prototype);
    expect(copy.a["polluted"]).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(copy.a, "__proto__")).toBe(
      true,
    );
    expect(JSON.stringify(copy)).toBe(JSON.stringify(source));
    assertPrototypeUntouched();
  });

  it("mutation helpers reject a caller entry carrying __proto__", () => {
    const entry = JSON.parse(protoEntry) as Record<string, unknown>;
    expect(() =>
      buildGameItemPlacementEvent({
        id: "room",
        placements: [entry as never],
      }),
    ).toThrow(/__proto__/);
  });
});

describe("malformed event shapes never throw (I7)", () => {
  const PK = "a".repeat(64);
  const bases: Record<string, NostrEvent> = {
    definition: makeEvent({
      kind: 31632,
      pubkey: PK,
      tags: [
        ["d", "g:food:c"],
        ["name", "C"],
        ["type", "food"],
      ],
    }),
    inventory: makeEvent({
      kind: 31633,
      pubkey: PK,
      tags: [
        ["d", "main"],
        ["a", `31632:${PK}:g:food:c`, "", "1"],
      ],
    }),
    placement: makeEvent({
      kind: 31634,
      pubkey: PK,
      tags: [["d", "room"]],
      content: '{"placements":[]}',
    }),
    spend: spendEvent({ id: "1".repeat(64), pubkey: OWNER }),
    fold: foldEvent({ id: "2".repeat(64), spends: ["1".repeat(64)] }),
  };
  const parsers: Record<string, (event: NostrEvent) => { ok: boolean }> = {
    definition: (e) => parseGameItemDefinitionResult(e),
    inventory: (e) => parseGameInventoryResult(e),
    placement: (e) => parseGameItemPlacementResult(e),
    spend: (e) => parseGameInventorySpendResult(e),
    fold: (e) => parseGameInventoryFoldResult(e),
  };
  const mutations: Record<string, (e: NostrEvent) => unknown> = {
    "empty pubkey": (e) => ({ ...e, pubkey: "" }),
    "whitespace pubkey": (e) => ({ ...e, pubkey: "  " }),
    "numeric pubkey": (e) => ({ ...e, pubkey: 5 }),
    "missing pubkey": (e) => ({ ...e, pubkey: undefined }),
    "null tag": (e) => ({ ...e, tags: [...e.tags, null] }),
    "string tag": (e) => ({ ...e, tags: [...e.tags, "t"] }),
    "null tag element": (e) => ({ ...e, tags: [...e.tags, ["t", null]] }),
    "numeric d value": (e) => ({
      ...e,
      tags: [["d", 5], ...e.tags.filter((t) => t[0] !== "d")],
    }),
    "missing tags": (e) => ({ ...e, tags: undefined }),
    "object tags": (e) => ({ ...e, tags: {} }),
    "numeric content": (e) => ({ ...e, content: 5 }),
    "null content": (e) => ({ ...e, content: null }),
    "null event": () => null,
    "array event": () => [],
  };

  for (const [kind, base] of Object.entries(bases)) {
    it(`${kind}: the unmutated fixture parses`, () => {
      expect(parsers[kind]?.(base).ok).toBe(true);
    });
    for (const [name, mutate] of Object.entries(mutations)) {
      it(`${kind}: ${name} returns ok:false`, () => {
        const event = mutate(base) as NostrEvent;
        let result: { ok: boolean } | undefined;
        expect(() => {
          result = parsers[kind]?.(event);
        }).not.toThrow();
        expect(result?.ok).toBe(false);
      });
    }
  }

  it("derivation and fold resolution report malformed events instead of throwing", () => {
    const inventory = snapshot({ items: { [STRAWBERRY]: 2 } });
    const good = spendEvent({ id: "3".repeat(64) });
    const state = deriveGameInventoryState({
      inventory,
      spends: [
        null as unknown as NostrEvent,
        { ...good, id: "5".repeat(64), tags: [null] } as unknown as NostrEvent,
        good,
      ],
    });
    expect(state.applied.map((s) => s.id)).toEqual([good.id]);
    expect(state.invalid).toHaveLength(2);

    const resolution = resolveGameInventoryFoldChain({
      inventoryAddress: FARM,
      headFoldId: "4".repeat(64),
      folds: [null as unknown as NostrEvent],
      spends: [null as unknown as NostrEvent],
    });
    expect(resolution.status).toBe("unresolved");
  });

  it("filterEventsByPlacementItemAddress skips events without usable tags", () => {
    const match = makeEvent({
      kind: 31634,
      tags: [["a", CARROT, "", "item"]],
    });
    const events = [
      null,
      { ...match, tags: undefined },
      { ...match, tags: [null, "x"] },
      match,
    ] as unknown as NostrEvent[];
    expect(filterEventsByPlacementItemAddress(events, CARROT)).toEqual([match]);
  });
});

describe("created_at on kind:1416 and kind:1417 (I3)", () => {
  const bad: unknown[] = [
    NaN,
    Infinity,
    -1,
    1.5,
    "100",
    null,
    undefined,
    1e300,
  ];

  it.each(bad)("rejects a spend with created_at %s", (createdAt) => {
    const event = {
      ...spendEvent({ id: "6".repeat(64) }),
      created_at: createdAt,
    } as unknown as NostrEvent;
    const result = parseGameInventorySpendResult(event);
    expect(result.ok).toBe(false);
    expect(
      validateGameInventorySpend(event).issues.map((i) => i.code),
    ).toContain("invalid-created-at");
  });

  it.each(bad)("rejects a fold manifest with created_at %s", (createdAt) => {
    const event = {
      ...foldEvent({ id: "7".repeat(64), spends: ["6".repeat(64)] }),
      created_at: createdAt,
    } as unknown as NostrEvent;
    expect(parseGameInventoryFoldResult(event).ok).toBe(false);
    expect(
      validateGameInventoryFold(event).issues.map((i) => i.code),
    ).toContain("invalid-created-at");
  });

  it("accepts created_at 0", () => {
    expect(
      parseGameInventorySpendResult(
        spendEvent({ id: "8".repeat(64), createdAt: 0 }),
      ).ok,
    ).toBe(true);
  });

  it("derives the same applied set for every input order when one spend has NaN created_at", () => {
    const inventory = snapshot({ items: { [STRAWBERRY]: 1 } });
    const nan: NostrEvent = {
      ...spendEvent({ id: "3".repeat(64) }),
      created_at: NaN,
    };
    const early = spendEvent({ id: "4".repeat(64), createdAt: 300 });
    const late = spendEvent({ id: "5".repeat(64), createdAt: 250 });
    const orders = [
      [nan, early, late],
      [early, nan, late],
      [early, late, nan],
      [late, early, nan],
    ];
    const applied = orders.map((spends) =>
      deriveGameInventoryState({ inventory, spends }).applied.map((s) => s.id),
    );
    for (const result of applied) {
      expect(result).toEqual([late.id]);
    }
  });
});

describe("large adversarial spend sets", () => {
  it("deduplicates many relay copies in linear time and reports each id once", () => {
    const inventory = snapshot({ items: { [STRAWBERRY]: 1 } });
    const spends: NostrEvent[] = [];
    for (let i = 0; i < 20_000; i++) {
      const event = spendEvent({ id: i.toString(16).padStart(64, "0") });
      spends.push(event, event);
    }
    const started = performance.now();
    const state = deriveGameInventoryState({ inventory, spends });
    const elapsed = performance.now() - started;
    expect(state.duplicateSpendIds).toHaveLength(20_000);
    expect(new Set(state.duplicateSpendIds).size).toBe(20_000);
    expect(state.applied).toHaveLength(1);
    // Generous bound: the quadratic version took about 20 s here.
    expect(elapsed).toBeLessThan(5_000);
  });
});
