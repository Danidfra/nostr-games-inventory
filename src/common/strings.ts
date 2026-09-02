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

/**
 * Deduplicate a list of string values, dropping blank entries and keeping the
 * first occurrence order.
 *
 * Shared by the relay-filter builders: a filter field that resolves to no
 * values must be omitted entirely rather than emitted as an empty array, which
 * most relays treat as "match nothing".
 */
export function uniqueNonBlank(
  values: readonly string[] | undefined,
): string[] {
  if (values === undefined) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (isBlank(value) || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}
