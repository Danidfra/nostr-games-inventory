/**
 * Shared numeric helpers.
 *
 * These are internal implementation details shared by the parsers, builders and
 * mutation helpers. They are intentionally NOT re-exported from the package's
 * public API.
 *
 * The rule across the whole library is that malformed numbers are never
 * silently coerced: strings are not parsed into numbers, and `NaN`, `Infinity`
 * and `-Infinity` are never accepted where a real coordinate is expected.
 */

/**
 * `true` only for a real, finite `number`.
 *
 * Numeric *strings* return `false`: `"1.5"` is not a number and must never be
 * coerced into one.
 */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * `true` only for a `number` that is a safe integer and greater than or equal
 * to zero.
 *
 * Used for the advisory `version` / `revision` content fields, which are
 * counters rather than measurements.
 */
export function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
