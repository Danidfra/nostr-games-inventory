import type { UnsignedEventTemplate } from "../../nostr/event.js";
import {
  KIND_GAME_ITEM_DEFINITION,
  type KindGameItemDefinition,
} from "../../common/constants.js";
import { serializeContent } from "../../common/json.js";
import { BASED_ON_MARKER, parseGameItemAddress } from "./address.js";
import type { BuildGameItemDefinitionInput } from "./types.js";

/**
 * Tag names fully managed by this builder. They MUST NOT appear in
 * `extraTags`: supplying one is a conflict and causes the builder to throw,
 * rather than silently emitting a duplicate or being ignored.
 */
const MANAGED_TAG_NAMES = new Set<string>([
  "d",
  "name",
  "type",
  "category",
  "image",
  "model_3d",
  "audio",
  "symbol",
  "rarity",
  "max_stack",
  "version",
  "context",
  "t",
  "alt",
]);

/**
 * Build an unsigned kind:31632 event template.
 *
 * The builder:
 * - validates required input (`id`, `name`, `type` must be non-empty and not
 *   whitespace-only);
 * - validates `maxStack` (positive decimal integer) and numeric `version`
 *   (finite);
 * - validates every `basedOn` reference (well-formed kind:31632 coordinate);
 * - never creates `id` or `sig`;
 * - emits tags in a stable, deterministic order to simplify testing;
 * - rejects `extraTags` that conflict with builder-managed tags (see
 *   {@link MANAGED_TAG_NAMES}); an `a` tag is only treated as conflicting when
 *   it carries the `based_on` marker, so other future `a` usages remain
 *   possible;
 * - appends the remaining `extraTags` verbatim after the managed tags.
 *
 * Valid values are never trimmed or otherwise mutated.
 *
 * @throws {Error} if a required field is missing/blank, an optional numeric
 * field is invalid, a `basedOn` reference is invalid, or an `extraTags` entry
 * conflicts with a builder-managed tag.
 */
export function buildGameItemDefinitionEvent(
  input: BuildGameItemDefinitionInput,
): UnsignedEventTemplate<KindGameItemDefinition> {
  const id = requireNonBlank(input.id, "id");
  const name = requireNonBlank(input.name, "name");
  const type = requireNonBlank(input.type, "type");

  const tags: string[][] = [
    ["d", id],
    ["name", name],
    ["type", type],
  ];

  pushOptional(tags, "category", input.category);
  pushOptional(tags, "image", input.image);
  pushOptional(tags, "model_3d", input.model3d);
  pushOptional(tags, "audio", input.audio);
  pushOptional(tags, "symbol", input.symbol);
  pushOptional(tags, "rarity", input.rarity);
  pushOptional(tags, "max_stack", validateMaxStack(input.maxStack));
  pushOptional(tags, "version", validateVersion(input.version));

  for (const context of input.contexts ?? []) {
    // Do not emit repeatable values that are blank; do not normalize others.
    if (!isBlank(context)) {
      tags.push(["context", context]);
    }
  }
  for (const topic of input.topics ?? []) {
    if (!isBlank(topic)) {
      tags.push(["t", topic]);
    }
  }
  for (const ref of input.basedOn ?? []) {
    if (parseGameItemAddress(ref.address) === null) {
      throw new Error(
        `buildGameItemDefinitionEvent: invalid \`basedOn.address\` (must be a kind:${KIND_GAME_ITEM_DEFINITION} coordinate): ${String(ref.address)}`,
      );
    }
    tags.push(["a", ref.address, ref.relay ?? "", BASED_ON_MARKER]);
  }

  pushOptional(tags, "alt", input.alt);

  for (const tag of input.extraTags ?? []) {
    assertExtraTagAllowed(tag);
    tags.push([...tag]);
  }

  return {
    kind: KIND_GAME_ITEM_DEFINITION,
    content: serializeContent(input.content),
    tags,
  };
}

/** A string is "blank" if it is empty or contains only whitespace. */
function isBlank(value: string): boolean {
  return typeof value !== "string" || value.trim() === "";
}

function requireNonBlank(value: string, field: string): string {
  if (isBlank(value)) {
    throw new Error(
      `buildGameItemDefinitionEvent: \`${field}\` is required and must be non-empty`,
    );
  }
  return value;
}

/**
 * Emit an optional string tag unless the value is missing or blank. Non-empty
 * values are never normalized.
 */
function pushOptional(
  tags: string[][],
  name: string,
  value: string | undefined,
): void {
  if (value !== undefined && !isBlank(value)) {
    tags.push([name, value]);
  }
}

/**
 * Validate `maxStack`. When provided it must be a positive decimal integer
 * (per the spec: "SHOULD be a positive integer"). `0`, negatives, decimals,
 * NaN, Infinity and non-numeric strings are rejected. Returns the canonical
 * string form, or `undefined` when not provided.
 */
function validateMaxStack(
  value: string | number | undefined,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "number") {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(
        `buildGameItemDefinitionEvent: \`maxStack\` must be a positive integer: ${String(value)}`,
      );
    }
    return String(value);
  }

  // String form: strictly a positive decimal integer (no sign, decimal point,
  // whitespace, exponent, or leading zeros).
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(
      `buildGameItemDefinitionEvent: \`maxStack\` must be a positive integer string: ${value}`,
    );
  }
  return value;
}

/**
 * Validate `version`. String versions are free-form and returned unchanged.
 * Numeric versions must be finite (NaN/Infinity are rejected and never
 * serialized). Returns the string form, or `undefined` when not provided.
 */
function validateVersion(
  value: string | number | undefined,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(
        `buildGameItemDefinitionEvent: numeric \`version\` must be finite: ${String(value)}`,
      );
    }
    return String(value);
  }
  return value;
}

/**
 * Reject `extraTags` that conflict with builder-managed tags.
 *
 * A tag conflicts when its name is in {@link MANAGED_TAG_NAMES}. The `a` tag is
 * special: it only conflicts when it carries the `based_on` marker at index 3,
 * because that is the specific `a` usage the builder manages. Other `a` tag
 * usages (for example future markers) are allowed through.
 */
function assertExtraTagAllowed(tag: string[]): void {
  const name = tag[0];
  if (name === undefined) {
    return;
  }

  if (name === "a") {
    if (tag[3] === BASED_ON_MARKER) {
      throw new Error(
        "buildGameItemDefinitionEvent: `extraTags` may not contain a builder-managed `a`+`based_on` tag; pass it via `basedOn` instead",
      );
    }
    return;
  }

  if (MANAGED_TAG_NAMES.has(name)) {
    throw new Error(
      `buildGameItemDefinitionEvent: \`extraTags\` may not contain the builder-managed tag \`${name}\``,
    );
  }
}
