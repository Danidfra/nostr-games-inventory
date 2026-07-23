import type { NostrEvent } from "../src/index.js";
import type { ParseResult } from "../src/index.js";
import { expect } from "vitest";

/**
 * Build a full NostrEvent for tests from a partial spec. Only `kind`, `tags`,
 * and `content` matter for parsing; the rest are filled with placeholders.
 */
export function makeEvent(partial: Partial<NostrEvent>): NostrEvent {
  return {
    id: partial.id ?? "test-id",
    pubkey: partial.pubkey ?? "test-pubkey",
    created_at: partial.created_at ?? 1_700_000_000,
    kind: partial.kind ?? 0,
    tags: partial.tags ?? [],
    content: partial.content ?? "",
    sig: partial.sig ?? "test-sig",
  };
}

/**
 * Assert that a {@link ParseResult} succeeded and return its value.
 *
 * This narrows the discriminated union so callers can access `.value` and
 * `.warnings` directly, and — unlike an `if (result.ok)` guard — it fails the
 * test (rather than silently skipping assertions) when parsing unexpectedly
 * returns `ok: false`.
 */
export function expectOk<T>(
  result: ParseResult<T>,
): Extract<ParseResult<T>, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`Expected parse to succeed, got error: ${result.error}`);
  }
  return result;
}
