import type { NostrEvent } from "../../nostr/event.js";
import {
  type ParseMode,
  type ParseResult,
  type ParseWarning,
  ok,
  fail,
} from "../../common/result.js";
import { getTagValue, getTagValues } from "../../common/tags.js";
import { parseContentJson } from "../../common/json.js";
import { KIND_GAME_ITEM_PLACEMENT } from "../../common/constants.js";
import { isPlainObject } from "../../common/objects.js";
import {
  buildGameItemPlacementAddress,
  PLACEMENT_ITEM_MARKER,
} from "./address.js";
import { validateGameItemPlacement } from "./validate.js";
import {
  referenceRequiresZ,
  validatePlacementEntryValue,
  validatePlacementReferenceValue,
  validatePlacementTargetValue,
} from "./content.js";
import { getPlacementItemTags, getPlacementTargetTags } from "./tags.js";
import { isGameItemPlacementMode } from "./guards.js";
import type {
  GameItemPlacement,
  GameItemPlacementEntry,
  GameItemPlacementReference,
  GameItemPlacementTarget,
} from "./types.js";

export interface ParseGameItemPlacementOptions {
  /**
   * `permissive` (default) drops malformed placement entries and a malformed
   * reference, reporting each as a warning. `strict` rejects the event in
   * those cases.
   *
   * Neither mode rejects for tag/content mismatches: the tags are a derived
   * index, so a stale index is a warning that tells the publisher to
   * republish, exactly as malformed `a` tags are handled in kind:31633.
   *
   * There is no `requireJsonContent` option: a placement event always requires
   * a JSON object `content` (see `validateGameItemPlacement`).
   */
  mode?: ParseMode;
  /**
   * Require item and target addresses to use canonical 64-char hex pubkeys.
   * Defaults to `false`, matching the rest of the package.
   */
  requireHexPubkey?: boolean;
}

/**
 * Parse a kind:31634 event into a {@link GameItemPlacement}, returning a
 * structured {@link ParseResult}.
 *
 * `content.placements` is authoritative. The `a` tags are treated purely as a
 * derived index: an `item`-marked tag with no matching placement is never
 * turned into a placement, it is reported as `orphaned-item-tag`.
 *
 * The event is rejected for the conditions in `validateGameItemPlacement`, and
 * additionally — in strict mode only — when any placement entry is malformed or
 * the reference is malformed.
 *
 * This parser makes no authorization decision. It does not check that the
 * author may modify the target, that the items are owned, that the issuer is
 * trusted, that the item fits the slot, or that the placement should render.
 */
export function parseGameItemPlacementResult(
  event: NostrEvent,
  options: ParseGameItemPlacementOptions = {},
): ParseResult<GameItemPlacement> {
  const mode: ParseMode = options.mode ?? "permissive";
  const requireHexPubkey = options.requireHexPubkey ?? false;
  const warnings: ParseWarning[] = [];

  const validation = validateGameItemPlacement(event, { requireHexPubkey });
  if (!validation.valid) {
    return fail(validation.issues.map((i) => i.message).join("; "), warnings);
  }

  // Validation guarantees a non-blank `d` and a JSON object `content`.
  const id = getTagValue(event.tags, "d") as string;
  const parsedContent = parseContentJson(event.content);
  const content =
    parsedContent.kind === "json" && isPlainObject(parsedContent.value)
      ? parsedContent.value
      : {};

  const rejections: string[] = [];

  // --- target ------------------------------------------------------------
  let target: GameItemPlacementTarget | undefined;
  const rawTarget = content["target"];
  if (rawTarget !== undefined) {
    const result = validatePlacementTargetValue(rawTarget, {
      requireHexPubkey,
    });
    // Validation already rejected a malformed target, so this always succeeds.
    if (result.ok) {
      target = result.value;
    }
  }

  // --- reference ---------------------------------------------------------
  let reference: GameItemPlacementReference | undefined;
  const rawReference = content["reference"];
  if (rawReference !== undefined) {
    const result = validatePlacementReferenceValue(rawReference);
    if (result.ok) {
      reference = result.value;
    } else {
      warnings.push({
        code: "invalid-reference",
        message: `\`content.reference\` is malformed and was ignored: ${result.reason}`,
      });
      rejections.push(`invalid reference: ${result.reason}`);
    }
  }

  // --- placement entries -------------------------------------------------
  const rawPlacements = content["placements"];
  if (rawPlacements === undefined) {
    // Absent `placements` is read as an empty document rather than a
    // rejection, so a publisher that means "nothing is placed" is understood
    // whichever spelling it used. A present-but-non-array `placements` is a
    // structural error and was already rejected by validation.
    warnings.push({
      code: "empty-required-value",
      message:
        "`content.placements` is absent; treated as an empty placement list",
    });
  }
  const entries: unknown[] = Array.isArray(rawPlacements) ? rawPlacements : [];

  const placements: GameItemPlacementEntry[] = [];
  const requireZ = referenceRequiresZ(reference);
  entries.forEach((raw, index) => {
    const result = validatePlacementEntryValue(raw, {
      requireHexPubkey,
      requireZ,
    });
    if (result.ok) {
      placements.push(result.value);
      return;
    }
    warnings.push({
      code: "invalid-placement-entry",
      message: `\`content.placements[${index}]\` is malformed and was ignored: ${result.reason}`,
    });
    rejections.push(
      `invalid placement entry at index ${index}: ${result.reason}`,
    );
  });

  if (mode === "strict" && rejections.length > 0) {
    return fail(rejections.join("; "), warnings);
  }

  warnAboutDuplicateIds(placements, warnings);
  warnAboutDuplicateEquipSlots(placements, warnings);
  warnAboutUnknownModes(placements, warnings);

  // --- derived item references -------------------------------------------
  const itemAddresses = uniqueItemAddresses(placements);
  const itemTags = getPlacementItemTags(event);
  warnAboutItemTags(itemAddresses, itemTags, warnings);

  // --- target relationship ------------------------------------------------
  const targetTags = getPlacementTargetTags(event);
  warnAboutTargetTags(target, targetTags, warnings);

  if (target === undefined && targetTags.length === 0) {
    warnings.push({
      code: "missing-target",
      message:
        "Placement declares no target in `content.target` and no target tag; consumers cannot tell what it applies to",
    });
  }

  // A reference only matters once something carries coordinates. Equipment-only
  // documents legitimately have none, so warning about them would be noise.
  if (
    reference === undefined &&
    placements.some((e) => e.position !== undefined)
  ) {
    warnings.push({
      code: "missing-reference",
      message:
        "Placement entries carry `position` but `content.reference` is absent; coordinates cannot be interpreted",
    });
  }

  const placement: GameItemPlacement = {
    id,
    address: buildGameItemPlacementAddress(event.pubkey, id),
    author: event.pubkey,
    kind: KIND_GAME_ITEM_PLACEMENT,
    contexts: getTagValues(event.tags, "context"),
    topics: getTagValues(event.tags, "t"),
    targetTags,
    placements,
    itemAddresses,
    itemTags,
    content: event.content,
    contentJson: content,
    event,
  };

  const alt = getTagValue(event.tags, "alt");
  if (alt !== undefined) {
    placement.alt = alt;
  }
  if (target !== undefined) {
    placement.target = target;
  }
  if (reference !== undefined) {
    placement.reference = reference;
  }
  const version = content["version"];
  if (typeof version === "number") {
    placement.version = version;
  }
  const revision = content["revision"];
  if (typeof revision === "number") {
    placement.revision = revision;
  }

  return ok(placement, warnings);
}

/**
 * Convenience wrapper returning the parsed placement or `null`.
 *
 * Prefer {@link parseGameItemPlacementResult} when you need warnings or the
 * rejection reason.
 */
export function parseGameItemPlacement(
  event: NostrEvent,
  options: ParseGameItemPlacementOptions = {},
): GameItemPlacement | null {
  const result = parseGameItemPlacementResult(event, options);
  return result.ok ? result.value : null;
}

/**
 * Unique `placements[].item` addresses in first-placement order. This is the
 * exact set a canonical builder derives `item` tags from.
 */
function uniqueItemAddresses(
  placements: readonly GameItemPlacementEntry[],
): string[] {
  const seen = new Set<string>();
  const addresses: string[] = [];
  for (const entry of placements) {
    if (seen.has(entry.item)) {
      continue;
    }
    seen.add(entry.item);
    addresses.push(entry.item);
  }
  return addresses;
}

function warnAboutDuplicateIds(
  placements: readonly GameItemPlacementEntry[],
  warnings: ParseWarning[],
): void {
  const counts = new Map<string, number>();
  for (const entry of placements) {
    counts.set(entry.id, (counts.get(entry.id) ?? 0) + 1);
  }
  for (const [entryId, count] of counts) {
    if (count > 1) {
      warnings.push({
        code: "duplicate-placement-id",
        message: `Duplicate placement entry id (${count}x): ${entryId}`,
      });
    }
  }
}

/**
 * Warn when a slot holds more than one equipped entry.
 *
 * Duplicates never invalidate the document; the helpers expose an explicit
 * first/last/all choice instead, and the canonical slot mutation helper is
 * deterministic last-wins.
 */
function warnAboutDuplicateEquipSlots(
  placements: readonly GameItemPlacementEntry[],
  warnings: ParseWarning[],
): void {
  const counts = new Map<string, number>();
  for (const entry of placements) {
    if (entry.mode !== "equip" || entry.slot === undefined) {
      continue;
    }
    counts.set(entry.slot, (counts.get(entry.slot) ?? 0) + 1);
  }
  for (const [slot, count] of counts) {
    if (count > 1) {
      warnings.push({
        code: "duplicate-equip-slot",
        message: `Slot has ${count} equipped entries: ${slot}`,
      });
    }
  }
}

/**
 * Warn once per unknown mode.
 *
 * Unknown modes stay valid: the warning exists because `mode` decides whether
 * an entry is equipment or a placed object, so a consumer that does not
 * recognize it has a decision to make. Unknown reference spaces and unknown
 * rotation types get no warning — they are inert data a renderer can ignore.
 */
function warnAboutUnknownModes(
  placements: readonly GameItemPlacementEntry[],
  warnings: ParseWarning[],
): void {
  const reported = new Set<string>();
  for (const entry of placements) {
    if (isGameItemPlacementMode(entry.mode) || reported.has(entry.mode)) {
      continue;
    }
    reported.add(entry.mode);
    warnings.push({
      code: "unknown-placement-mode",
      message: `Unknown placement mode (kept as-is): ${entry.mode}`,
    });
  }
}

/**
 * Reconcile the derived `item` tag index against the authoritative placements.
 *
 * Every consumer action here is "republish the event with repaired tags";
 * nothing changes how the placement itself is read.
 */
function warnAboutItemTags(
  itemAddresses: readonly string[],
  itemTags: readonly { address: string; tag: string[] }[],
  warnings: ParseWarning[],
): void {
  const tagCounts = new Map<string, number>();
  for (const itemTag of itemTags) {
    tagCounts.set(itemTag.address, (tagCounts.get(itemTag.address) ?? 0) + 1);
  }

  for (const address of itemAddresses) {
    if (!tagCounts.has(address)) {
      warnings.push({
        code: "missing-item-tag",
        message: `Placed item has no derived \`${PLACEMENT_ITEM_MARKER}\` tag; the event is not discoverable by \`#a\`: ${address}`,
      });
    }
  }

  const placed = new Set(itemAddresses);
  for (const [address, count] of tagCounts) {
    if (!placed.has(address)) {
      warnings.push({
        code: "orphaned-item-tag",
        message: `\`${PLACEMENT_ITEM_MARKER}\` tag references an address with no matching placement; it is not a placement: ${address}`,
      });
    }
    if (count > 1) {
      warnings.push({
        code: "duplicate-item-tag",
        message: `Duplicate \`${PLACEMENT_ITEM_MARKER}\` tag (${count}x): ${address}`,
      });
    }
  }
}

function warnAboutTargetTags(
  target: GameItemPlacementTarget | undefined,
  targetTags: readonly { type: string; value: string }[],
  warnings: ParseWarning[],
): void {
  if (targetTags.length > 1) {
    warnings.push({
      code: "duplicate-target-tag",
      message: `Placement declares ${targetTags.length} target tags; a canonical placement declares at most one`,
    });
  }

  if (target === undefined) {
    // Without an authoritative target there is nothing to disagree with: the
    // tags are exposed as metadata and left alone.
    return;
  }

  let candidate: { type: string; value: string } | undefined;
  if (target.type === "address" && typeof target["address"] === "string") {
    candidate = { type: "address", value: target["address"] };
  } else if (target.type === "internal" && typeof target["id"] === "string") {
    candidate = { type: "internal", value: target["id"] };
  }
  if (candidate === undefined) {
    // An unknown target type has no canonical tag form, so no tag can
    // contradict it.
    return;
  }
  const expected = candidate;

  const matched = targetTags.some(
    (tag) => tag.type === expected.type && tag.value === expected.value,
  );
  if (matched) {
    return;
  }

  warnings.push({
    code: "target-mismatch",
    message:
      targetTags.length === 0
        ? `Authoritative \`content.target\` has no matching target tag: ${expected.value}`
        : `Target tags do not match authoritative \`content.target\` (${expected.value}); \`content\` wins`,
  });
}
