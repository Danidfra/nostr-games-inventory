/**
 * Parsing modes shared across the library.
 *
 * - `permissive` (default): follow the "SHOULD tolerate" rules of the specs.
 *   Invalid tags are ignored, invalid JSON content does not block tag parsing,
 *   duplicate inventory items resolve using the recommended default strategy.
 * - `strict`: reject the event when the specs allow rejection (for example
 *   duplicate inventory item references, or invalid JSON content when JSON is
 *   required).
 *
 * "MUST reject" rules (wrong kind, missing/empty `d`, missing required item
 * definition tags) apply in both modes.
 */
export type ParseMode = "permissive" | "strict";

/**
 * A recoverable, non-fatal issue detected while parsing.
 *
 * Warnings never prevent parsing in permissive mode. They are surfaced so
 * callers can audit what was ignored or coerced.
 */
export interface ParseWarning {
  /** Machine-readable warning code. */
  code: ParseWarningCode;
  /** Human-readable explanation. */
  message: string;
  /** The offending tag, when the warning relates to a specific tag. */
  tag?: string[];
}

export type ParseWarningCode =
  | "invalid-json-content"
  | "invalid-item-tag"
  | "invalid-image-tag"
  | "missing-primary-image"
  | "multiple-primary-images"
  | "invalid-quantity"
  | "wrong-referenced-kind"
  | "malformed-address"
  | "duplicate-item"
  | "invalid-grant-tag"
  | "empty-required-value"
  | "invalid-revision"
  // kind:31634 Game Item Placement
  | "invalid-placement-entry"
  | "duplicate-placement-id"
  | "duplicate-equip-slot"
  | "unknown-placement-mode"
  | "invalid-reference"
  | "missing-reference"
  | "missing-target"
  | "target-mismatch"
  | "duplicate-target-tag"
  | "missing-item-tag"
  | "orphaned-item-tag"
  | "duplicate-item-tag"
  // kind:31633 fold reference, kind:1416 / kind:1417 metadata
  | "invalid-fold-tag"
  | "duplicate-fold-reference"
  | "invalid-metadata-tag";

/**
 * Structured parse result.
 *
 * `ok: true` means a usable value was produced (possibly with warnings about
 * ignored tags). `ok: false` means the event was rejected as invalid for this
 * kind.
 */
export type ParseResult<T> =
  | { ok: true; value: T; warnings: ParseWarning[] }
  | { ok: false; error: string; warnings: ParseWarning[] };

export function ok<T>(value: T, warnings: ParseWarning[] = []): ParseResult<T> {
  return { ok: true, value, warnings };
}

export function fail<T = never>(
  error: string,
  warnings: ParseWarning[] = [],
): ParseResult<T> {
  return { ok: false, error, warnings };
}
