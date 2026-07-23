import type { NostrEvent } from "../nostr/event.js";

/**
 * Return the value of the first tag with the given name, or `undefined` if no
 * such tag exists or its value slot is missing.
 */
export function getTagValue(
  tags: string[][],
  name: string,
): string | undefined {
  for (const tag of tags) {
    if (tag[0] === name) {
      return tag[1];
    }
  }
  return undefined;
}

/**
 * Return all values of tags with the given name (index 1), skipping tags whose
 * value slot is missing.
 */
export function getTagValues(tags: string[][], name: string): string[] {
  const values: string[] = [];
  for (const tag of tags) {
    if (tag[0] === name && typeof tag[1] === "string") {
      values.push(tag[1]);
    }
  }
  return values;
}

/**
 * Return the `d` tag value of an event or its raw tags.
 *
 * Returns `undefined` if there is no `d` tag or its value is missing. Note that
 * an empty-string `d` value is returned as `""` (the caller decides whether an
 * empty `d` is acceptable; per both specs it is not).
 */
export function getDTag(source: NostrEvent | string[][]): string | undefined {
  const tags = Array.isArray(source) ? source : source.tags;
  return getTagValue(tags, "d");
}
