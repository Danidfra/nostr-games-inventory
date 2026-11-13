import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as lib from "../src/index.js";
import type { NostrEvent, ParseResult } from "../src/index.js";

/**
 * Compatibility guard: every event the 0.5.0 test suite parsed must still
 * parse to byte-identical output.
 *
 * `fixtures/parse-golden-0.5.0.json` holds the 330 distinct events passed to
 * the five `parse*Result` functions while the 0.5.0 suite (commit f1b39e7) ran,
 * and, for each event and each of four option sets, the sha256 of
 * `JSON.stringify(result)` as 0.5.0 produced it (with `value.event` removed:
 * it is the input object itself). A hardening change that alters the result
 * of any previously-parsed event fails here.
 */

type ParserName =
  | "parseGameItemDefinitionResult"
  | "parseGameInventoryResult"
  | "parseGameItemPlacementResult"
  | "parseGameInventorySpendResult"
  | "parseGameInventoryFoldResult";

interface GoldenCase {
  parser: ParserName;
  event: NostrEvent;
  results: Record<string, string>;
}

const golden = JSON.parse(
  readFileSync(
    new URL("./fixtures/parse-golden-0.5.0.json", import.meta.url),
    "utf8",
  ),
) as { cases: GoldenCase[] };

const OPTION_SETS = {
  permissive: { mode: "permissive", requireHexPubkey: false },
  "permissive+hex": { mode: "permissive", requireHexPubkey: true },
  strict: { mode: "strict", requireHexPubkey: false },
  "strict+hex": { mode: "strict", requireHexPubkey: true },
} as const;

function serialize(result: ParseResult<unknown>, event: NostrEvent): string {
  if (!result.ok) {
    return JSON.stringify(result);
  }
  const value = result.value as Record<string, unknown>;
  expect(value["event"]).toBe(event);
  const rest = { ...value };
  delete rest["event"];
  return JSON.stringify({ ...result, value: rest });
}

describe("parse output is identical to 0.5.0 for every recorded event", () => {
  it("covers all five kinds", () => {
    const parsers = new Set(golden.cases.map((c) => c.parser));
    expect(parsers.size).toBe(5);
    expect(golden.cases.length).toBeGreaterThan(300);
  });

  it("matches every recorded result", () => {
    const mismatches: string[] = [];
    for (const [index, testCase] of golden.cases.entries()) {
      const parse = lib[testCase.parser] as (
        event: NostrEvent,
        options: object,
      ) => ParseResult<unknown>;
      for (const [label, options] of Object.entries(OPTION_SETS)) {
        const text = serialize(parse(testCase.event, options), testCase.event);
        const hash = createHash("sha256").update(text).digest("hex");
        if (hash !== testCase.results[label]) {
          mismatches.push(
            `case ${index} (${testCase.parser}, ${label}): ${text.slice(0, 300)}`,
          );
        }
      }
    }
    expect(mismatches).toEqual([]);
  });
});
