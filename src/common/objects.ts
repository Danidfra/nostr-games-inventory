/**
 * Shared helpers for working with untrusted JSON-derived values.
 *
 * Internal: not re-exported from the package's public API.
 */

/**
 * Narrow an unknown value to a plain JSON object.
 *
 * Arrays and `null` are rejected: both are `typeof "object"` but neither can
 * carry named fields, so neither is a usable object in any of the content
 * schemas this library parses.
 */
export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Recursively copy a JSON-compatible value.
 *
 * This is how the library keeps its immutability promise for data it does not
 * fully model: unknown nested fields are copied structurally rather than being
 * re-serialized through a typed shape, so nothing is dropped and no caller can
 * mutate a parsed placement through a shared nested reference.
 *
 * Non-plain values (functions, class instances, `Date`, …) are returned by
 * reference. They cannot appear in content parsed from a Nostr event, and
 * builder inputs containing them would already fail `JSON.stringify`.
 */
export function cloneJsonLike<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry: unknown) => cloneJsonLike(entry)) as unknown as T;
  }
  if (isPlainObject(value)) {
    const copy: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      copy[key] = cloneJsonLike(entry);
    }
    return copy as T;
  }
  return value;
}
