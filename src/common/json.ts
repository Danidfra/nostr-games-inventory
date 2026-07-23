/**
 * Result of attempting to parse a `content` string as JSON.
 */
export type ContentParseResult =
  | { kind: "empty" }
  | { kind: "json"; value: unknown }
  | { kind: "invalid"; raw: string };

/**
 * Attempt to parse an event `content` string as JSON without throwing.
 *
 * An empty string is treated as {@link ContentParseResult} `empty`, matching
 * both specifications which allow `content` to be an empty string.
 *
 * This never throws: invalid JSON is reported as `invalid` so callers can
 * decide how to react based on their parse mode.
 */
export function parseContentJson(content: string): ContentParseResult {
  if (content === "") {
    return { kind: "empty" };
  }
  try {
    return { kind: "json", value: JSON.parse(content) as unknown };
  } catch {
    return { kind: "invalid", raw: content };
  }
}

/**
 * Normalize a `content` input that may be either a preserialized string or a
 * value to be JSON-serialized.
 *
 * - `undefined` -> `""` (the spec default for both kinds).
 * - `string` -> returned as-is (the caller is responsible for its validity).
 * - anything else -> `JSON.stringify`.
 *
 * This function always either returns a valid string or throws; it never
 * returns `undefined`. `JSON.stringify` returns `undefined` for values that
 * are not JSON-serializable (for example `function`, `symbol`, or a top-level
 * `undefined` reached via another path), and throws on circular references. In
 * both cases a clear error is raised.
 *
 * @throws {Error} when the value is not JSON-serializable (including circular
 * references).
 */
export function serializeContent(content: unknown): string {
  if (content === undefined) {
    return "";
  }
  if (typeof content === "string") {
    return content;
  }

  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(content);
  } catch (cause) {
    const detail = cause instanceof Error ? `: ${cause.message}` : "";
    throw new Error(
      `serializeContent: value is not JSON-serializable (circular reference?)${detail}`,
    );
  }

  if (serialized === undefined) {
    throw new Error(
      "serializeContent: value is not JSON-serializable (produced `undefined`, e.g. a function or symbol)",
    );
  }

  return serialized;
}
