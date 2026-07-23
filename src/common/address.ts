/**
 * Helpers for NIP-01 addressable event coordinates of the form:
 *
 * ```text
 * <kind>:<pubkey>:<d-tag>
 * ```
 *
 * IMPORTANT: the `d-tag` may itself contain `:` characters. The recommended
 * `d` format in kind:31632 is `<namespace>:<category>:<slug>` (for example
 * `blobbi:food:carrot`), which means a full address such as
 * `31632:pubkey123:blobbi:food:carrot` has more than three colon-separated
 * segments. Address parsing therefore splits only on the first two colons and
 * treats everything after the second colon as the `d-tag`.
 */

import { isBlank } from "./strings.js";

export interface AddressableEventAddress {
  kind: number;
  pubkey: string;
  identifier: string;
}

/**

 * Options controlling how strict pubkey validation is.
 *
 * Placeholder pubkeys are accepted by default to support fixtures, drafts,
 * and permissive parsing. Consumers may enable canonical 64-character hex
 * validation.
 *
 * - By default, only a non-empty pubkey segment is required.
 * - When `requireHexPubkey` is `true`, the pubkey must be a 64-character
 *   lowercase hexadecimal string, which is the canonical Nostr pubkey form.
 */
export interface AddressParseOptions {
  requireHexPubkey?: boolean;
}

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Build an addressable event coordinate string.
 *
 * @throws if any component is invalid (empty pubkey/identifier or non-integer
 * kind). Builders in this library validate their inputs before calling this,
 * so a throw here indicates a programming error rather than bad user data.
 */
export function buildAddressableEventAddress(
  kind: number,
  pubkey: string,
  identifier: string,
): string {
  if (!Number.isInteger(kind) || kind < 0) {
    throw new Error(`Invalid kind for address: ${String(kind)}`);
  }
  if (pubkey.trim() === "") {
    throw new Error("Cannot build address with empty pubkey");
  }
  if (identifier.trim() === "") {
    throw new Error("Cannot build address with empty identifier");
  }
  return `${kind}:${pubkey}:${identifier}`;
}

/**
 * Parse an addressable event coordinate string.
 *
 * Returns `null` when the string is not a well-formed `<kind>:<pubkey>:<d>`
 * coordinate. Everything after the second colon is treated as the identifier
 * (`d` tag), preserving any colons it contains.
 */
export function parseAddressableEventAddress(
  address: string,
  options: AddressParseOptions = {},
): AddressableEventAddress | null {
  if (typeof address !== "string") {
    return null;
  }

  const firstColon = address.indexOf(":");
  if (firstColon <= 0) {
    return null;
  }
  const secondColon = address.indexOf(":", firstColon + 1);
  if (secondColon < 0) {
    return null;
  }

  const kindStr = address.slice(0, firstColon);
  const pubkey = address.slice(firstColon + 1, secondColon);
  const identifier = address.slice(secondColon + 1);

  if (!/^\d+$/.test(kindStr)) {
    return null;
  }
  const kind = Number.parseInt(kindStr, 10);
  if (!Number.isSafeInteger(kind)) {
    return null;
  }

  // Reject blank (empty or whitespace-only) segments. Valid values are never
  // trimmed or otherwise mutated.
  if (isBlank(pubkey) || isBlank(identifier)) {
    return null;
  }

  if (options.requireHexPubkey && !HEX64.test(pubkey)) {
    return null;
  }

  return { kind, pubkey, identifier };
}
