import type { NostrEvent } from "../../nostr/event.js";
import { KIND_GAME_ITEM_PLACEMENT } from "../../common/constants.js";
import { getTagValue } from "../../common/tags.js";
import { parseContentJson } from "../../common/json.js";
import { isBlank } from "../../common/strings.js";
import { isNonNegativeSafeInteger } from "../../common/numbers.js";
import { isPlainObject } from "../../common/objects.js";
import {
  validatePlacementTargetValue,
  type PlacementValidationOptions,
} from "./content.js";

/**
 * A structured validation issue for a kind:31634 event.
 */
export interface ItemPlacementValidationIssue {
  code:
    | "wrong-kind"
    | "missing-d"
    | "empty-d"
    | "invalid-json-content"
    | "invalid-content-shape"
    | "invalid-placements"
    | "invalid-target"
    | "invalid-version"
    | "invalid-revision";
  message: string;
}

export type ItemPlacementValidationOptions = PlacementValidationOptions;

export interface ItemPlacementValidationResult {
  valid: boolean;
  issues: ItemPlacementValidationIssue[];
}

/**
 * Validate the MUST-reject conditions for a kind:31634 Game Item Placement.
 *
 * An event is rejected — in permissive mode too — if:
 *
 * - `kind` is not 31634;
 * - the `d` tag is missing, empty or whitespace-only;
 * - `content` is not valid JSON, or is JSON that is not an object (an array,
 *   `null`, a string or a number);
 * - `content.placements` is present but is not an array;
 * - `content.target` is present and its known shape is malformed;
 * - `content.version` or `content.revision` is present and is not a
 *   non-negative safe integer.
 *
 * Note the deliberate difference from kind:31632 and kind:31633, where tags are
 * the source of truth and `content` is optional metadata: a placement event
 * carries its state *in* `content`, so an empty or non-object `content` is not
 * a tolerable omission — there is no placement document to read. `content` is
 * therefore required to be a JSON object regardless of parse mode, and there is
 * no `requireJsonContent` option.
 *
 * Individual malformed *entries* are not checked here: in permissive mode they
 * are dropped with a warning, and only strict mode rejects the event (see
 * `parseGameItemPlacementResult`).
 */
export function validateGameItemPlacement(
  event: NostrEvent,
  options: ItemPlacementValidationOptions = {},
): ItemPlacementValidationResult {
  const issues: ItemPlacementValidationIssue[] = [];

  if (event.kind !== KIND_GAME_ITEM_PLACEMENT) {
    issues.push({
      code: "wrong-kind",
      message: `Expected kind ${KIND_GAME_ITEM_PLACEMENT}, got ${event.kind}`,
    });
  }

  const d = getTagValue(event.tags, "d");
  if (d === undefined) {
    issues.push({ code: "missing-d", message: "Missing required `d` tag" });
  } else if (isBlank(d)) {
    issues.push({ code: "empty-d", message: "`d` tag value is empty" });
  }

  const parsed = parseContentJson(event.content);
  if (parsed.kind === "invalid") {
    issues.push({
      code: "invalid-json-content",
      message: "`content` is not valid JSON",
    });
    return { valid: false, issues };
  }
  if (parsed.kind === "empty") {
    issues.push({
      code: "invalid-json-content",
      message:
        "`content` is empty; a placement event MUST carry a JSON object holding its placement document",
    });
    return { valid: false, issues };
  }
  if (!isPlainObject(parsed.value)) {
    issues.push({
      code: "invalid-content-shape",
      message: "`content` JSON must be an object",
    });
    return { valid: false, issues };
  }

  const content = parsed.value;

  const placements = content["placements"];
  if (placements !== undefined && !Array.isArray(placements)) {
    issues.push({
      code: "invalid-placements",
      message: "`content.placements` must be an array when present",
    });
  }

  const target = content["target"];
  if (target !== undefined) {
    const result = validatePlacementTargetValue(target, options);
    if (!result.ok) {
      issues.push({ code: "invalid-target", message: result.reason });
    }
  }

  // `version` and `revision` are advisory counters. When present they must be
  // real non-negative safe integers; numeric strings are never coerced.
  const version = content["version"];
  if (version !== undefined && !isNonNegativeSafeInteger(version)) {
    issues.push({
      code: "invalid-version",
      message: "`content.version` must be a non-negative safe integer",
    });
  }

  const revision = content["revision"];
  if (revision !== undefined && !isNonNegativeSafeInteger(revision)) {
    issues.push({
      code: "invalid-revision",
      message: "`content.revision` must be a non-negative safe integer",
    });
  }

  return { valid: issues.length === 0, issues };
}
