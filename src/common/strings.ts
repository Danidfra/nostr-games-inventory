/**
 * Shared string helpers.
 */

/**
 * A string is "blank" if it is not a string, is empty, or contains only
 * whitespace. Callers must never trim otherwise-valid values based on this
 * check; it only decides whether a value counts as absent.
 */
export function isBlank(value: unknown): boolean {
  return typeof value !== "string" || value.trim() === "";
}
