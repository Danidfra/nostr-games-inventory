import { describe, it, expect } from "vitest";
import {
  parseGameItemPlacementResult,
  validateGameItemPlacement,
  toBuildGameItemPlacementInput,
  buildGameItemPlacementEvent,
  KIND_GAME_ITEM_PLACEMENT,
  type NostrEvent,
} from "../src/index.js";
import {
  cloneJsonLike,
  MAX_JSON_NESTING_DEPTH,
} from "../src/common/objects.js";
import { makeEvent, expectOk } from "./helpers.js";

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
