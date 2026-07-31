import { isNonNegativeSafeInteger } from "../../common/numbers.js";

/**
 * The relationship between two placement documents for the same address.
 *
 * - `unknown` — one or both revisions are missing or invalid, so nothing can be
 *   concluded. Fall back to ordinary Nostr addressable-event resolution.
 * - `stale` — the incoming revision is lower than the current one.
 * - `equivalent` — same revision, and the two are demonstrably the same state
 *   (same event id, or byte-identical original `content`).
 * - `conflict` — same revision, but neither the event id nor the original
 *   `content` matches: two different states claim the same revision.
 * - `ahead` — the incoming revision is higher than the current one.
 */
export type GameItemPlacementRevisionStatus =
  "unknown" | "stale" | "equivalent" | "conflict" | "ahead";

/**
 * The minimal shape {@link compareGameItemPlacementRevisions} needs. Every
 * parsed `GameItemPlacement` satisfies it.
 */
export interface GameItemPlacementRevisionCandidate {
  /** `content.revision`, when the document declared a valid one. */
  revision?: number;
  /** The original `content` string, compared byte-for-byte. */
  content?: string;
  /** The source event, used only for its `id`. */
  event?: { id?: string };
}

/**
 * Compare an incoming placement document against the current one.
 *
 * `revision` is **advisory**. It is a hint that lets an application notice a
 * lost update or a fork; it does not replace Nostr addressable-event
 * resolution, and this function never fetches anything.
 *
 * Two states that share a revision are only called `equivalent` on hard
 * evidence: the same event id, or byte-identical original `content`. JSON is
 * never re-serialized or canonicalized to manufacture a match, because two
 * different source documents that happen to normalize alike are still two
 * different documents.
 *
 * `created_at` is deliberately **not** consulted. Wall-clock timestamps are
 * attacker- and clock-skew-controlled, so using them to break an equal-revision
 * tie would silently pick a winner where the honest answer is `conflict`.
 * Resolving a conflict is an application decision.
 */
export function compareGameItemPlacementRevisions(
  current: GameItemPlacementRevisionCandidate,
  incoming: GameItemPlacementRevisionCandidate,
): GameItemPlacementRevisionStatus {
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

  const currentContent = current.content;
  const incomingContent = incoming.content;
  if (
    typeof currentContent === "string" &&
    currentContent !== "" &&
    currentContent === incomingContent
  ) {
    return "equivalent";
  }

  return "conflict";
}
