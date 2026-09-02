/**
 * Advisory revision support for kind:31633 Game Inventory.
 *
 * ## Why this exists
 *
 * kind:31633 is an addressable event, so a publish does not patch an inventory
 * — it REPLACES it. Two writers that build from the same base therefore
 * destroy each other's work: whichever event lands last wins, whole. That is a
 * real hazard the moment more than one application writes a player's
 * inventories, and nothing in Nostr provides compare-and-swap to prevent it.
 *
 * `revision` does not prevent it either. It is a counter a writer increments so
 * that a *later reader* can notice that two states disagree, instead of a lost
 * update passing silently. It is exactly the model kind:31634 already uses; the
 * semantics here are deliberately identical.
 *
 * ## Where the counter lives
 *
 * In a `["revision", "<n>"]` **tag**, not in `content`.
 *
 * This is the one place kind:31633 must diverge from kind:31634's shape, and
 * the kind's own semantics force it: for a placement, `content` is the
 * authoritative state document, while for an inventory the TAGS are
 * authoritative and `content` is optional metadata that "MUST NOT be required
 * to reconstruct the inventory" — and is an empty string by default. Writing a
 * counter into `content` would mean inventing a JSON object where publishers
 * legitimately have none, and clobbering whatever UI metadata a peer stored
 * there. A tag is the natural home for indexable, authoritative inventory data.
 *
 * The comparison semantics below are unchanged from kind:31634.
 */

import { isNonNegativeSafeInteger } from "../../common/numbers.js";

/** The tag name carrying the advisory inventory revision counter. */
export const INVENTORY_REVISION_TAG = "revision" as const;

/**
 * Parse a `revision` tag value into a non-negative integer.
 *
 * Returns `null` for anything that is not a canonical non-negative decimal
 * integer string. Unlike a quantity, `"0"` is valid: a first revision may
 * legitimately be zero.
 *
 * Intentionally rejects, and never coerces:
 * - `undefined` / `null` / missing
 * - `"-1"` (negative)
 * - `"1.5"` (decimal)
 * - `"abc"`, `"1e3"`, `"0x1"`, `" 1 "`, `"+1"` (not a plain decimal integer)
 * - `"03"` (leading zeros; a well-formed publisher never emits them)
 * - values beyond `Number.MAX_SAFE_INTEGER`
 */
export function parseInventoryRevision(
  raw: string | undefined | null,
): number | null {
  if (typeof raw !== "string") {
    return null;
  }
  if (!/^(?:0|[1-9]\d*)$/.test(raw)) {
    return null;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value < 0) {
    return null;
  }
  return value;
}

/**
 * Encode a non-negative integer revision as its canonical decimal string.
 *
 * @throws {Error} if the value is not a non-negative safe integer.
 */
export function encodeInventoryRevision(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      `Cannot encode non-non-negative-integer revision: ${String(value)}`,
    );
  }
  return String(value);
}

/**
 * The relationship between two inventory states for the same address.
 *
 * - `unknown` — one or both revisions are missing or invalid, so nothing can be
 *   concluded. Fall back to ordinary Nostr addressable-event resolution.
 * - `stale` — the incoming revision is lower than the current one.
 * - `equivalent` — same revision, and the two are demonstrably the same state
 *   (same event id, or byte-identical original tags).
 * - `conflict` — same revision, but neither the event id nor the original tags
 *   match: two different states claim the same revision, which means a lost
 *   update or a fork.
 * - `ahead` — the incoming revision is higher than the current one.
 */
export type GameInventoryRevisionStatus =
  "unknown" | "stale" | "equivalent" | "conflict" | "ahead";

/**
 * The minimal shape {@link compareGameInventoryRevisions} needs. Every parsed
 * `GameInventory` satisfies it.
 */
export interface GameInventoryRevisionCandidate {
  /** The `revision` tag value, when the event declared a valid one. */
  revision?: number;
  /**
   * The source event. `id` and `tags` are the only fields read, and both are
   * used solely as evidence that two equal-revision states are the same state.
   */
  event?: {
    id?: string;
    tags?: readonly (readonly string[])[];
  };
}

/**
 * Compare an incoming inventory against the current one.
 *
 * ## What this guarantees
 *
 * That two states carrying valid, DIFFERENT revisions can be ordered, and that
 * two states carrying the same revision are reported as `conflict` unless there
 * is hard evidence they are the same state.
 *
 * ## What this does NOT guarantee
 *
 * - **It is not a lock, and not compare-and-swap.** Nostr has neither. Two
 *   writers can still both publish; this only lets a reader afterwards notice
 *   that they did.
 * - **It does not replace addressable-event resolution.** Relays still keep the
 *   newest event per `(kind, pubkey, d)` regardless of any revision, and this
 *   function never fetches anything.
 * - **It cannot detect a lost update against a peer that omits `revision`.**
 *   A missing or invalid counter on either side yields `unknown`.
 * - **It does not merge.** Resolving a `conflict` is an application decision;
 *   the kind:31633 spec forbids merging item tags across versions.
 *
 * ## Deliberate omissions
 *
 * `created_at` is never consulted. Wall-clock timestamps are publisher- and
 * clock-skew-controlled, so using one to break an equal-revision tie would
 * silently pick a winner where the honest answer is `conflict`.
 *
 * Tags are compared element-by-element exactly as received. They are never
 * sorted, normalized, or re-derived: two tag lists that would normalize alike
 * are still two different documents, and pretending otherwise would manufacture
 * an `equivalent` that hides a real fork.
 */
export function compareGameInventoryRevisions(
  current: GameInventoryRevisionCandidate,
  incoming: GameInventoryRevisionCandidate,
): GameInventoryRevisionStatus {
  const currentRevision = current.revision;
  const incomingRevision = incoming.revision;

  if (
    !isNonNegativeSafeInteger(currentRevision) ||
    !isNonNegativeSafeInteger(incomingRevision)
  ) {
    return "unknown";
  }

  if (incomingRevision < currentRevision) {
    return "stale";
  }
  if (incomingRevision > currentRevision) {
    return "ahead";
  }

  const currentId = current.event?.id;
  const incomingId = incoming.event?.id;
  if (
    typeof currentId === "string" &&
    currentId !== "" &&
    currentId === incomingId
  ) {
    return "equivalent";
  }

  if (sameTags(current.event?.tags, incoming.event?.tags)) {
    return "equivalent";
  }

  return "conflict";
}

/**
 * Element-wise tag equality. Both sides must be present and non-empty to count
 * as evidence — an absent or empty tag list proves nothing.
 */
function sameTags(
  a: readonly (readonly string[])[] | undefined,
  b: readonly (readonly string[])[] | undefined,
): boolean {
  // Candidates may be hand-built by callers, so the shape is checked at runtime
  // rather than trusted from the type. `isTagList` narrows without widening to
  // `any`, which a bare `Array.isArray` on a readonly array type would do.
  if (!isTagList(a) || !isTagList(b)) {
    return false;
  }
  if (a.length === 0 || a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (!isTag(left) || !isTag(right)) {
      return false;
    }
    if (left.length !== right.length) {
      return false;
    }
    for (let j = 0; j < left.length; j += 1) {
      if (left[j] !== right[j]) {
        return false;
      }
    }
  }
  return true;
}

function isTagList(value: unknown): value is readonly (readonly string[])[] {
  return Array.isArray(value);
}

function isTag(value: unknown): value is readonly string[] {
  return Array.isArray(value);
}
