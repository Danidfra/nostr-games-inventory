/**
 * Public quantity helpers for kind:31633 inventory `a` tags.
 *
 * Per the spec, quantity MUST be encoded as a decimal integer string. Parsers
 * SHOULD ignore item references whose quantity is missing, `0`, negative,
 * decimal, or non-numeric. A "valid" stored inventory quantity is therefore a
 * positive integer.
 *
 * - {@link parseInventoryQuantity} parses an untrusted tag string, tolerantly
 *   returning `null` for anything that is not a canonical positive decimal
 *   integer string.
 * - {@link encodeInventoryQuantity} encodes a positive integer back into its
 *   canonical decimal string form.
 *
 * Strict validation of public numeric inputs (used by the builder and the
 * inventory helpers) lives in `quantity.internal.ts` and is not part of the
 * public API.
 */

/**
 * Parse an inventory quantity *string* into a positive integer.
 *
 * Returns `null` for any value that is not a strictly positive canonical
 * decimal integer string. This intentionally rejects:
 * - `undefined` / `null` / missing
 * - `"0"` and `"-1"` (not positive)
 * - `"1.5"` (decimal)
 * - `"abc"`, `"1e3"`, `"0x1"`, `" 1 "`, `"+1"` (not a plain decimal integer)
 * - `"03"` (leading zeros; a well-formed publisher never emits them)
 */
export function parseInventoryQuantity(
  raw: string | undefined | null,
): number | null {
  if (typeof raw !== "string") {
    return null;
  }
  if (!/^[1-9]\d*$/.test(raw)) {
    return null;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

/**
 * Encode a positive integer quantity as its canonical decimal string.
 *
 * @throws if the value is not a positive safe integer.
 */
export function encodeInventoryQuantity(value: number): string {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(
      `Cannot encode non-positive-integer quantity: ${String(value)}`,
    );
  }
  return String(value);
}
