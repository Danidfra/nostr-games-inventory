import type { UnsignedEventTemplate } from "../../nostr/event.js";
import {
  KIND_GAME_INVENTORY,
  type KindGameInventory,
} from "../../common/constants.js";
import { serializeContent } from "../../common/json.js";
import { isBlank } from "../../common/strings.js";
import {
  parseGameItemAddress,
  KIND_GAME_ITEM_DEFINITION,
} from "../game-item-definition/address.js";
import {
  assertNonNegativeInteger,
  addQuantitiesChecked,
} from "./quantity.internal.js";
import { encodeInventoryQuantity } from "./quantity.js";
import { GRANT_MARKER } from "./address.js";
import type {
  BuildGameInventoryInput,
  BuildGameInventoryItemInput,
  DuplicateStrategy,
} from "./types.js";

/**
 * Tag names fully managed by this builder. They MUST NOT appear in
 * `extraTags`; supplying one throws rather than emitting a duplicate.
 *
 * `a` is intentionally excluded from this set because it needs the marker-aware
 * check in {@link assertExtraTagAllowed}: in kind:31633 *every* `a` tag is the
 * inventory item representation, so all `a` tags are rejected.
 */
const MANAGED_TAG_NAMES = new Set<string>(["d", "context", "name", "alt"]);

/**
 * Build an unsigned kind:31633 event template.
 *
 * The builder:
 * - validates the required `d` id (non-empty, not whitespace-only);
 * - validates each item address (must be a kind:31632 coordinate);
 * - requires each item quantity to be a non-negative safe integer; `0` is
 *   omitted, and negatives/decimals/NaN/Infinity/unsafe integers throw (they
 *   are never floored, clamped, or silently dropped);
 * - resolves duplicate addresses per `duplicateStrategy` (default `last`), and
 *   throws if a `sum` overflows Number.MAX_SAFE_INTEGER;
 * - rejects grants with an empty/whitespace-only event id;
 * - emits tags in a stable, deterministic order;
 * - never creates `id` or `sig`;
 * - rejects `extraTags` that conflict with builder-managed tags and appends the
 *   rest verbatim after the managed tags.
 *
 * Non-empty display values are never trimmed or otherwise normalized.
 *
 * @throws {Error} for a blank `id`, invalid item address, invalid quantity,
 * duplicate under the `strict` strategy, `sum` overflow, a blank grant event
 * id, or an `extraTags` entry that conflicts with a managed tag.
 */
export function buildGameInventoryEvent(
  input: BuildGameInventoryInput,
): UnsignedEventTemplate<KindGameInventory> {
  if (isBlank(input.id)) {
    throw new Error(
      "buildGameInventoryEvent: `id` is required and must be non-empty",
    );
  }

  const strategy: DuplicateStrategy = input.duplicateStrategy ?? "last";
  const items = normalizeItems(input.items ?? [], strategy);

  const tags: string[][] = [["d", input.id]];

  for (const context of input.contexts ?? []) {
    // Repeatable display metadata: omit when blank, never normalize otherwise.
    if (!isBlank(context)) {
      tags.push(["context", context]);
    }
  }
  if (input.name !== undefined && !isBlank(input.name)) {
    tags.push(["name", input.name]);
  }

  for (const item of items) {
    tags.push([
      "a",
      item.address,
      item.relay,
      encodeInventoryQuantity(item.quantity),
    ]);
  }

  for (const grant of input.grants ?? []) {
    if (isBlank(grant.eventId)) {
      throw new Error(
        "buildGameInventoryEvent: grant `eventId` must be non-empty",
      );
    }
    tags.push(["e", grant.eventId, grant.relay ?? "", GRANT_MARKER]);
  }

  if (input.alt !== undefined && !isBlank(input.alt)) {
    tags.push(["alt", input.alt]);
  }

  for (const tag of input.extraTags ?? []) {
    assertExtraTagAllowed(tag);
    tags.push([...tag]);
  }

  return {
    kind: KIND_GAME_INVENTORY,
    content: serializeContent(input.content),
    tags,
  };
}

interface NormalizedItem {
  address: string;
  relay: string;
  quantity: number;
}

function normalizeItems(
  inputs: BuildGameInventoryItemInput[],
  strategy: DuplicateStrategy,
): NormalizedItem[] {
  const order: string[] = [];
  const byAddress = new Map<string, NormalizedItem>();

  for (const raw of inputs) {
    if (parseGameItemAddress(raw.address) === null) {
      throw new Error(
        `buildGameInventoryEvent: invalid item address (must be a kind:${KIND_GAME_ITEM_DEFINITION} coordinate): ${String(raw.address)}`,
      );
    }
    // Public input: strictly validate; do not floor/clamp/omit-invalid.
    const quantity = assertNonNegativeInteger(raw.quantity, "item quantity");
    if (quantity === 0) {
      // `0` means omit the item per the spec.
      continue;
    }
    const relay = raw.relay ?? "";

    const existing = byAddress.get(raw.address);
    if (existing === undefined) {
      order.push(raw.address);
      byAddress.set(raw.address, { address: raw.address, relay, quantity });
      continue;
    }

    if (strategy === "strict") {
      throw new Error(
        `buildGameInventoryEvent: duplicate item address under strict strategy: ${raw.address}`,
      );
    } else if (strategy === "sum") {
      existing.quantity = addQuantitiesChecked(
        existing.quantity,
        quantity,
        "summed item quantity",
      );
      existing.relay = relay;
    } else {
      existing.quantity = quantity;
      existing.relay = relay;
    }
  }

  return order.map((addr) => byAddress.get(addr) as NormalizedItem);
}

/**
 * Reject `extraTags` that conflict with builder-managed tags.
 *
 * Rejected: `d`, `context`, `name`, `alt`; every `a` tag (all `a` tags are the
 * inventory item representation in kind:31633); and `e` tags carrying the
 * `grant` marker at index 3. Unrelated forward-compatible tags — including
 * non-grant `e` tags — are allowed.
 */
function assertExtraTagAllowed(tag: string[]): void {
  const name = tag[0];
  if (name === undefined) {
    return;
  }

  if (name === "a") {
    throw new Error(
      "buildGameInventoryEvent: `extraTags` may not contain an `a` tag; pass inventory items via `items` instead",
    );
  }

  if (name === "e") {
    if (tag[3] === GRANT_MARKER) {
      throw new Error(
        "buildGameInventoryEvent: `extraTags` may not contain a grant `e` tag; pass it via `grants` instead",
      );
    }
    return;
  }

  if (MANAGED_TAG_NAMES.has(name)) {
    throw new Error(
      `buildGameInventoryEvent: \`extraTags\` may not contain the builder-managed tag \`${name}\``,
    );
  }
}
