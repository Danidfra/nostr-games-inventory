import type { UnsignedEventTemplate } from "../../nostr/event.js";
import {
  KIND_GAME_ITEM_PLACEMENT,
  type KindGameItemPlacement,
} from "../../common/constants.js";
import { serializeContent } from "../../common/json.js";
import { isBlank } from "../../common/strings.js";
import { isNonNegativeSafeInteger } from "../../common/numbers.js";
import { cloneJsonLike } from "../../common/objects.js";
import {
  PLACEMENT_ITEM_MARKER,
  PLACEMENT_TARGET_MARKER,
  PLACEMENT_TARGET_TAG,
} from "./address.js";
import {
  referenceRequiresZ,
  validatePlacementEntryValue,
  validatePlacementReferenceValue,
  validatePlacementTargetValue,
} from "./content.js";
import { isPlacementItemTag, isPlacementTargetTag } from "./tags.js";
import type {
  BuildGameItemPlacementInput,
  GameItemPlacement,
  GameItemPlacementEntry,
  GameItemPlacementTarget,
} from "./types.js";

/**
 * Simple tag names fully managed by this builder. They MUST NOT appear in
 * `extraTags`: supplying one is a conflict and throws, rather than silently
 * emitting a duplicate.
 *
 * `a` and `target` are handled separately because they need marker-aware
 * checks — an `a` tag only conflicts when it carries the `item` or `target`
 * marker.
 */
const MANAGED_TAG_NAMES = new Set<string>(["d", "context", "t", "alt"]);

/** `content` keys the builder owns; `contentExtra` may not redefine them. */
const MANAGED_CONTENT_KEYS = new Set<string>([
  "version",
  "revision",
  "target",
  "reference",
  "placements",
]);

/**
 * Build an unsigned kind:31634 event template.
 *
 * ## What it manages
 *
 * `content` is authoritative and the tags are regenerated from it:
 *
 * - `["d", "<id>"]`;
 * - one `["context", …]` per supplied context, one `["t", …]` per topic;
 * - **at most one** canonical target relationship, derived from
 *   `content.target`: `["a", "<address>", "<relay>", "target"]` for an address
 *   target, `["target", "<id>"]` for an internal target;
 * - one `["a", "<item-address>", "<relay>", "item"]` per **unique** item
 *   address, in first-placement order — never duplicated;
 * - `["alt", …]` when supplied. It is never auto-generated.
 *
 * ## Preserved tags
 *
 * `preserveTags` (typically `placement.event.tags`) is carried over with stale
 * managed tags stripped, so rebuilding never duplicates or strands them.
 * Unrelated tags survive in their original relative order — including `a` tags
 * with no marker or a different marker, which are never treated as placements.
 *
 * Target tags are stripped **only** when `target` is a known type, because only
 * then can a canonical replacement be derived. With no target, or a target
 * whose `type` this version does not define, any preserved target tags are the
 * sole remaining representation and are kept as-is.
 *
 * ## Determinism
 *
 * Tags are emitted in a fixed order and `content` keys are inserted in a fixed
 * order, so identical input produces byte-identical output. No canonical-JSON
 * dependency is introduced; this is ordinary `JSON.stringify` over a
 * deterministically constructed object.
 *
 * The builder never signs, never publishes, never fetches, and never checks
 * ownership, inventory quantities, issuer trust or slot compatibility.
 *
 * @throws {Error} for a blank `id`, a malformed target/reference/entry, an
 * invalid `version`/`revision`, a `contentExtra` key the builder manages, or an
 * `extraTags` entry that conflicts with a managed tag.
 */
export function buildGameItemPlacementEvent(
  input: BuildGameItemPlacementInput,
): UnsignedEventTemplate<KindGameItemPlacement> {
  if (isBlank(input.id)) {
    throw new Error(
      "buildGameItemPlacementEvent: `id` is required and must be non-empty",
    );
  }

  const target = validateTargetInput(input.target);
  const reference = validateReferenceInput(input.reference);
  const placements = validateEntriesInput(
    input.placements ?? [],
    referenceRequiresZ(reference),
  );

  if (input.version !== undefined && !isNonNegativeSafeInteger(input.version)) {
    throw new Error(
      `buildGameItemPlacementEvent: \`version\` must be a non-negative safe integer: ${String(input.version)}`,
    );
  }
  if (
    input.revision !== undefined &&
    !isNonNegativeSafeInteger(input.revision)
  ) {
    throw new Error(
      `buildGameItemPlacementEvent: \`revision\` must be a non-negative safe integer: ${String(input.revision)}`,
    );
  }

  const content: Record<string, unknown> = {};
  if (input.version !== undefined) {
    content["version"] = input.version;
  }
  if (input.revision !== undefined) {
    content["revision"] = input.revision;
  }
  if (target !== undefined) {
    content["target"] = target;
  }
  if (reference !== undefined) {
    content["reference"] = reference;
  }
  content["placements"] = placements;
  for (const [key, value] of Object.entries(input.contentExtra ?? {})) {
    if (MANAGED_CONTENT_KEYS.has(key)) {
      throw new Error(
        `buildGameItemPlacementEvent: \`contentExtra\` may not contain the builder-managed content key \`${key}\``,
      );
    }
    content[key] = cloneJsonLike(value);
  }

  const preserved = input.preserveTags ?? [];
  const canonicalTarget = deriveTargetTag(target, input.relays, preserved);
  const tags: string[][] = [["d", input.id]];

  for (const context of input.contexts ?? []) {
    // Repeatable metadata: omit when blank, never normalize otherwise.
    if (!isBlank(context)) {
      tags.push(["context", context]);
    }
  }
  for (const topic of input.topics ?? []) {
    if (!isBlank(topic)) {
      tags.push(["t", topic]);
    }
  }
  if (canonicalTarget !== undefined) {
    tags.push(canonicalTarget);
  }
  for (const address of uniqueItemAddresses(placements)) {
    tags.push([
      "a",
      address,
      resolveItemRelay(address, input.relays, preserved),
      PLACEMENT_ITEM_MARKER,
    ]);
  }
  if (input.alt !== undefined && !isBlank(input.alt)) {
    tags.push(["alt", input.alt]);
  }

  const stripTargetTags = canonicalTarget !== undefined;
  for (const tag of preserved) {
    if (isManagedTag(tag, stripTargetTags)) {
      continue;
    }
    tags.push([...tag]);
  }

  for (const tag of input.extraTags ?? []) {
    assertExtraTagAllowed(tag);
    tags.push([...tag]);
  }

  return {
    kind: KIND_GAME_ITEM_PLACEMENT,
    content: serializeContent(content),
    tags,
  };
}

/**
 * Turn a parsed placement back into builder input without losing data.
 *
 * This is the round-trip path: unknown top-level `content` fields are carried
 * through `contentExtra`, unknown entry fields ride along inside the entries
 * themselves, and unrelated tags come back through `preserveTags`.
 *
 * Note that only *valid* entries round-trip. Entries the parser rejected are
 * deliberately not republished; they remain available for repair workflows on
 * `placement.contentJson`.
 *
 * Spread the result to override fields, for example to bump the revision:
 *
 * ```ts
 * buildGameItemPlacementEvent({
 *   ...toBuildGameItemPlacementInput(placement),
 *   revision: (placement.revision ?? 0) + 1,
 * });
 * ```
 */
export function toBuildGameItemPlacementInput(
  placement: GameItemPlacement,
): BuildGameItemPlacementInput {
  const contentExtra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(placement.contentJson)) {
    if (MANAGED_CONTENT_KEYS.has(key)) {
      continue;
    }
    contentExtra[key] = cloneJsonLike(value);
  }

  const result: BuildGameItemPlacementInput = {
    id: placement.id,
    placements: placement.placements.map((entry) => cloneJsonLike(entry)),
    contexts: [...placement.contexts],
    topics: [...placement.topics],
    contentExtra,
    preserveTags: placement.event.tags.map((tag) => [...tag]),
  };

  if (placement.alt !== undefined) {
    result.alt = placement.alt;
  }
  if (placement.target !== undefined) {
    result.target = cloneJsonLike(placement.target);
  }
  if (placement.reference !== undefined) {
    result.reference = cloneJsonLike(placement.reference);
  }
  if (placement.version !== undefined) {
    result.version = placement.version;
  }
  if (placement.revision !== undefined) {
    result.revision = placement.revision;
  }

  return result;
}

function validateTargetInput(
  target: GameItemPlacementTarget | undefined,
): GameItemPlacementTarget | undefined {
  if (target === undefined) {
    return undefined;
  }
  const result = validatePlacementTargetValue(target);
  if (!result.ok) {
    throw new Error(`buildGameItemPlacementEvent: ${result.reason}`);
  }
  return result.value;
}

function validateReferenceInput(
  reference: BuildGameItemPlacementInput["reference"],
): BuildGameItemPlacementInput["reference"] {
  if (reference === undefined) {
    return undefined;
  }
  const result = validatePlacementReferenceValue(reference);
  if (!result.ok) {
    throw new Error(`buildGameItemPlacementEvent: ${result.reason}`);
  }
  return result.value;
}

function validateEntriesInput(
  entries: readonly GameItemPlacementEntry[],
  requireZ: boolean,
): GameItemPlacementEntry[] {
  return entries.map((entry, index) => {
    const result = validatePlacementEntryValue(entry, { requireZ });
    if (!result.ok) {
      throw new Error(
        `buildGameItemPlacementEvent: invalid \`placements[${index}]\`: ${result.reason}`,
      );
    }
    return result.value;
  });
}

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

/**
 * Relay hint for a derived item tag: the caller-supplied map first, then the
 * relay from a matching preserved item tag, then `""`.
 */
function resolveItemRelay(
  address: string,
  relays: Record<string, string> | undefined,
  preserved: readonly string[][],
): string {
  const mapped = relays?.[address];
  if (mapped !== undefined && mapped !== "") {
    return mapped;
  }
  for (const tag of preserved) {
    if (isPlacementItemTag(tag) && tag[1] === address) {
      const relay = tag[2];
      if (relay !== undefined && relay !== "") {
        return relay;
      }
    }
  }
  return "";
}

/**
 * Derive the single canonical target tag, or `undefined` when the target is
 * absent or of a type this version cannot express as a tag.
 */
function deriveTargetTag(
  target: GameItemPlacementTarget | undefined,
  relays: Record<string, string> | undefined,
  preserved: readonly string[][],
): string[] | undefined {
  if (target === undefined) {
    return undefined;
  }

  if (target.type === "address" && typeof target["address"] === "string") {
    const address = target["address"];
    const declared = target["relay"];
    const relay =
      typeof declared === "string" && declared !== ""
        ? declared
        : resolveTargetRelay(address, relays, preserved);
    return ["a", address, relay, PLACEMENT_TARGET_MARKER];
  }

  if (target.type === "internal" && typeof target["id"] === "string") {
    return [PLACEMENT_TARGET_TAG, target["id"]];
  }

  return undefined;
}

function resolveTargetRelay(
  address: string,
  relays: Record<string, string> | undefined,
  preserved: readonly string[][],
): string {
  const mapped = relays?.[address];
  if (mapped !== undefined && mapped !== "") {
    return mapped;
  }
  for (const tag of preserved) {
    if (
      tag[0] === "a" &&
      tag[3] === PLACEMENT_TARGET_MARKER &&
      tag[1] === address
    ) {
      const relay = tag[2];
      if (relay !== undefined && relay !== "") {
        return relay;
      }
    }
  }
  return "";
}

/**
 * `true` when a preserved tag is a stale copy of something this builder
 * regenerates.
 */
function isManagedTag(tag: string[], stripTargetTags: boolean): boolean {
  const name = tag[0];
  if (name === undefined) {
    return false;
  }
  if (MANAGED_TAG_NAMES.has(name)) {
    return true;
  }
  if (isPlacementItemTag(tag)) {
    return true;
  }
  if (stripTargetTags && isPlacementTargetTag(tag)) {
    return true;
  }
  return false;
}

/**
 * Reject `extraTags` that conflict with builder-managed tags.
 *
 * An `a` tag only conflicts when it carries the `item` or `target` marker, so
 * unrelated and future `a` relationships remain possible.
 */
function assertExtraTagAllowed(tag: string[]): void {
  const name = tag[0];
  if (name === undefined) {
    return;
  }

  if (name === "a") {
    if (tag[3] === PLACEMENT_ITEM_MARKER) {
      throw new Error(
        "buildGameItemPlacementEvent: `extraTags` may not contain a builder-managed `a`+`item` tag; item tags are derived from `placements`",
      );
    }
    if (tag[3] === PLACEMENT_TARGET_MARKER) {
      throw new Error(
        "buildGameItemPlacementEvent: `extraTags` may not contain a builder-managed `a`+`target` tag; pass it via `target` instead",
      );
    }
    return;
  }

  if (name === PLACEMENT_TARGET_TAG) {
    throw new Error(
      "buildGameItemPlacementEvent: `extraTags` may not contain a builder-managed `target` tag; pass it via `target` instead",
    );
  }

  if (MANAGED_TAG_NAMES.has(name)) {
    throw new Error(
      `buildGameItemPlacementEvent: \`extraTags\` may not contain the builder-managed tag \`${name}\``,
    );
  }
}
