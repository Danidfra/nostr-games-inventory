import type { NostrEvent } from "../../nostr/event.js";
import { KIND_GAME_INVENTORY } from "../../common/constants.js";
import { getTagValue } from "../../common/tags.js";
import { parseContentJson } from "../../common/json.js";
import { isBlank } from "../../common/strings.js";

export interface InventoryValidationIssue {
  code: "wrong-kind" | "missing-d" | "empty-d" | "invalid-json-content";
  message: string;
}

export interface InventoryValidationOptions {
  /**
   * When `true`, non-empty invalid JSON content is treated as invalid. The
   * spec only allows rejecting invalid JSON when NOT in permissive mode, so
   * this defaults to `false`.
   */
  requireJsonContent?: boolean;
}

export interface InventoryValidationResult {
  valid: boolean;
  issues: InventoryValidationIssue[];
}

/**
 * Validate the MUST-reject conditions for a kind:31633 inventory.
 *
 * An event MUST be rejected if:
 * - `kind` is not 31633
 * - the `d` tag is missing
 * - the `d` tag is empty or contains only whitespace
 *
 * A whitespace-only `d` value is treated as empty; values are never trimmed.
 * Item-level problems (bad quantity, wrong referenced kind, malformed address)
 * do NOT invalidate the inventory; those items are ignored during parsing.
 */
export function validateGameInventory(
  event: NostrEvent,
  options: InventoryValidationOptions = {},
): InventoryValidationResult {
  const issues: InventoryValidationIssue[] = [];

  if (event.kind !== KIND_GAME_INVENTORY) {
    issues.push({
      code: "wrong-kind",
      message: `Expected kind ${KIND_GAME_INVENTORY}, got ${event.kind}`,
    });
  }

  const d = getTagValue(event.tags, "d");
  if (d === undefined) {
    issues.push({ code: "missing-d", message: "Missing required `d` tag" });
  } else if (isBlank(d)) {
    issues.push({ code: "empty-d", message: "`d` tag value is empty" });
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
