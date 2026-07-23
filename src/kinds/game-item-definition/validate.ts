import type { NostrEvent } from "../../nostr/event.js";
import { KIND_GAME_ITEM_DEFINITION } from "../../common/constants.js";
import { getTagValue } from "../../common/tags.js";
import { parseContentJson } from "../../common/json.js";

/**
 * A structured validation issue for a kind:31632 event.
 */
export interface ItemDefinitionValidationIssue {
  code:
    | "wrong-kind"
    | "missing-d"
    | "empty-d"
    | "missing-name"
    | "empty-name"
    | "missing-type"
    | "empty-type"
    | "invalid-json-content";
  message: string;
}

export interface ItemDefinitionValidationOptions {
  /**
   * When `true`, `content` must be empty or valid JSON. This mirrors the spec:
   * an item definition is rejected for invalid JSON only when the client
   * "requires strict JSON content". Defaults to `false`.
   */
  requireJsonContent?: boolean;
}

export interface ItemDefinitionValidationResult {
  valid: boolean;
  issues: ItemDefinitionValidationIssue[];
}

/** A string is "blank" if it is empty or contains only whitespace. */
function isBlank(value: string): boolean {
  return value.trim() === "";
}

/**
 * Validate that an event is a well-formed kind:31632 Game Item Definition.
 *
 * Per the spec, an event is rejected as an item definition if:
 * - `kind` is not 31632
 * - the `d` tag is missing or empty
 * - the `name` tag is missing or empty
 * - the `type` tag is missing or empty
 * - (only when {@link ItemDefinitionValidationOptions.requireJsonContent})
 *   `content` is not valid JSON
 *
 * A required value that contains only whitespace is treated as empty. Values
 * are never trimmed or otherwise mutated.
 */
export function validateGameItemDefinition(
  event: NostrEvent,
  options: ItemDefinitionValidationOptions = {},
): ItemDefinitionValidationResult {
  const issues: ItemDefinitionValidationIssue[] = [];

  if (event.kind !== KIND_GAME_ITEM_DEFINITION) {
    issues.push({
      code: "wrong-kind",
      message: `Expected kind ${KIND_GAME_ITEM_DEFINITION}, got ${event.kind}`,
    });
  }

  const d = getTagValue(event.tags, "d");
  if (d === undefined) {
    issues.push({ code: "missing-d", message: "Missing required `d` tag" });
  } else if (isBlank(d)) {
    issues.push({ code: "empty-d", message: "`d` tag value is empty" });
  }

  const name = getTagValue(event.tags, "name");
  if (name === undefined) {
    issues.push({
      code: "missing-name",
      message: "Missing required `name` tag",
    });
  } else if (isBlank(name)) {
    issues.push({ code: "empty-name", message: "`name` tag value is empty" });
  }

  const type = getTagValue(event.tags, "type");
  if (type === undefined) {
    issues.push({
      code: "missing-type",
      message: "Missing required `type` tag",
    });
  } else if (isBlank(type)) {
    issues.push({ code: "empty-type", message: "`type` tag value is empty" });
  }

  if (options.requireJsonContent) {
    const parsed = parseContentJson(event.content);
    if (parsed.kind === "invalid") {
      issues.push({
        code: "invalid-json-content",
        message: "`content` is not valid JSON",
      });
    }
  }

  return { valid: issues.length === 0, issues };
}
