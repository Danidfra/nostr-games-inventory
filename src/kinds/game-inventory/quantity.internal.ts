/**
 * Internal quantity validation helpers for kind:31633.
 *
 * These are implementation details shared between the builder, parser, and
 * inventory helpers. They are intentionally NOT re-exported from the package's
 * public API (see `index.ts`, which only re-exports `quantity.ts`).
 */

/** Upper bound for safe integer quantities. */
export const MAX_QUANTITY = Number.MAX_SAFE_INTEGER;

/**
 * Assert that a public numeric input is a non-negative safe integer.
 *
 * `0` is accepted (it means "omit"/"remove" the item). Negative values,
 * decimals, `NaN`, `Infinity`, and integers beyond
 * {@link Number.MAX_SAFE_INTEGER} are rejected by throwing. The value is never
 * coerced, floored, or clamped.
 *
 * @throws {Error} when `value` is not a non-negative safe integer.
 */
export function assertNonNegativeInteger(value: number, label: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`${label} must be a number, got: ${String(value)}`);
  }
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be finite, got: ${String(value)}`);
  }
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer, got: ${String(value)}`);
  }
  if (value < 0) {
    throw new Error(`${label} must be non-negative, got: ${String(value)}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new Error(
      `${label} exceeds Number.MAX_SAFE_INTEGER, got: ${String(value)}`,
    );
  }
  return value;
}

/**
 * Add two non-negative integers, throwing if the result would exceed
 * {@link Number.MAX_SAFE_INTEGER}. Both operands are assumed already validated
 * as non-negative safe integers.
 *
 * @throws {Error} on overflow.
 */
export function addQuantitiesChecked(
  a: number,
  b: number,
  label: string,
): number {
  const sum = a + b;
  if (sum > MAX_QUANTITY || !Number.isSafeInteger(sum)) {
    throw new Error(
      `${label} overflow: ${String(a)} + ${String(b)} exceeds Number.MAX_SAFE_INTEGER`,
    );
  }
  return sum;
}
