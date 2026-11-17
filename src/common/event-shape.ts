/**
 * NIP-01 structural checks shared by every validator.
 *
 * Internal: not re-exported from the package's public API.
 *
 * Events reach this library from relays and other untrusted sources, often
 * as plain `JSON.parse` output, so the TypeScript `NostrEvent` type is a
 * promise nobody has checked. These checks run first in every `validate*`
 * function, so the rest of the code may rely on the declared shape and the
 * parsers keep their contract: data problems return `ok: false`, they never
 * throw.
 */

/**
 * Return a reason the value is not a structurally valid Nostr event, or
 * `null` when it is.
 *
 * Checked: the value is an object; `pubkey` is a non-empty string; `tags` is
 * an array whose every entry is an array of strings; `content` is a string.
 * Nothing is checked that a NIP-01 event could legitimately violate, and kind,
 * id and signature remain the business of the kind-specific validators and of
 * the caller.
 */
export function eventShapeIssue(event: unknown): string | null {
  if (typeof event !== "object" || event === null || Array.isArray(event)) {
    return "event must be an object";
  }
  const record = event as Record<string, unknown>;

  const pubkey = record["pubkey"];
  if (typeof pubkey !== "string" || pubkey.trim() === "") {
    return "`pubkey` must be a non-empty string";
  }

  const tags = record["tags"];
  if (!Array.isArray(tags)) {
    return "`tags` must be an array";
  }
  for (const [index, tag] of tags.entries()) {
    if (!Array.isArray(tag)) {
      return `\`tags[${index}]\` must be an array of strings`;
    }
    for (const element of tag) {
      if (typeof element !== "string") {
        return `\`tags[${index}]\` must be an array of strings`;
      }
    }
  }

  if (typeof record["content"] !== "string") {
    return "`content` must be a string";
  }

  return null;
}
