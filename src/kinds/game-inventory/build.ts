import type { UnsignedEventTemplate } from "../../nostr/event.js";
import {
  KIND_GAME_INVENTORY,
  type KindGameInventory,
} from "../../common/constants.js";
import { serializeContent } from "../../common/json.js";
import { isNonNegativeSafeInteger } from "../../common/numbers.js";
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
import { GRANT_MARKER, INVENTORY_FOLD_MARKER } from "./address.js";
import { INVENTORY_REVISION_TAG, encodeInventoryRevision } from "./revision.js";
import type {
  BuildGameInventoryInput,
  BuildGameInventoryItemInput,
  DuplicateStrategy,
  GameInventory,
} from "./types.js";

/**
 * Tag names fully managed by this builder. They MUST NOT appear in
 * `extraTags`; supplying one throws rather than emitting a duplicate.
 *
 * `a` is intentionally excluded from this set because it needs the marker-aware
 * check in {@link assertExtraTagAllowed}: in kind:31633 *every* `a` tag is the
 * inventory item representation, so all `a` tags are rejected.
 */
const MANAGED_TAG_NAMES = new Set<string>([
  "d",
  INVENTORY_REVISION_TAG,
  "context",
  "name",
  "alt",
]);

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
 * - emits the optional fold manifest reference as
 *   `["e", "<fold-id>", "<relay>", "fold"]`, rejecting a blank id;
 * - emits tags in a stable, deterministic order;
 * - never creates `id` or `sig`;
 * - validates `revision` (a non-negative safe integer) and emits it as a
 *   `["revision", "<n>"]` tag when supplied;
 * - carries `preserveTags` over with stale managed tags stripped, so a rewrite
 *   never destroys another client's tags and never strands a duplicate;
 * - rejects `extraTags` that conflict with builder-managed tags and appends the
 *   rest verbatim after the preserved tags.
 *
 * Emitted tag order is fixed and deterministic:
 *
 * ```text
 * d -> revision -> context* -> name -> a* -> e(grant)* -> e(fold) -> alt
 *   -> preserved tags -> extraTags
 * ```
 *
 * Non-empty display values are never trimmed or otherwise normalized.
 *
 * @throws {Error} for a blank `id`, invalid item address, invalid quantity,
 * duplicate under the `strict` strategy, `sum` overflow, a blank grant or fold
 * event id, or an `extraTags` entry that conflicts with a managed tag.
 */
export function buildGameInventoryEvent(
  input: BuildGameInventoryInput,
): UnsignedEventTemplate<KindGameInventory> {
  if (isBlank(input.id)) {
    throw new Error(
      "buildGameInventoryEvent: `id` is required and must be non-empty",
    );
  }

  if (
    input.revision !== undefined &&
    !isNonNegativeSafeInteger(input.revision)
  ) {
    throw new Error(
      `buildGameInventoryEvent: \`revision\` must be a non-negative safe integer: ${String(input.revision)}`,
    );
  }

  const strategy: DuplicateStrategy = input.duplicateStrategy ?? "last";
  const items = normalizeItems(input.items ?? [], strategy);

  const tags: string[][] = [["d", input.id]];

  if (input.revision !== undefined) {
    tags.push([
      INVENTORY_REVISION_TAG,
      encodeInventoryRevision(input.revision),
    ]);
  }

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

  if (input.fold !== undefined) {
    if (isBlank(input.fold.eventId)) {
      throw new Error(
        "buildGameInventoryEvent: fold `eventId` must be non-empty",
      );
    }
    tags.push([
      "e",
      input.fold.eventId,
      input.fold.relay ?? "",
      INVENTORY_FOLD_MARKER,
    ]);
  }

  if (input.alt !== undefined && !isBlank(input.alt)) {
    tags.push(["alt", input.alt]);
  }

  for (const tag of input.preserveTags ?? []) {
    if (isManagedInventoryTag(tag)) {
      continue;
    }
    tags.push([...tag]);
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
 * Rejected: `d`, `revision`, `context`, `name`, `alt`; every `a` tag (all `a`
 * tags are the inventory item representation in kind:31633); and `e` tags
 * carrying the `grant` or `fold` marker at index 3. Unrelated
 * forward-compatible tags — including other `e` tags — are allowed.
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
    if (tag[3] === INVENTORY_FOLD_MARKER) {
      throw new Error(
        "buildGameInventoryEvent: `extraTags` may not contain a fold `e` tag; pass it via `fold` instead",
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

/**
 * `true` when a preserved tag is a stale copy of something this builder
 * regenerates from the structured input.
 *
 * Every `a` tag is managed: in kind:31633 an `a` tag *is* the item
 * representation, and items are rebuilt from `items`. An `e` tag is only
 * managed when it carries the `grant` or `fold` marker, so unrelated and
 * future `e` relationships written by other clients survive a rewrite.
 */
function isManagedInventoryTag(tag: string[]): boolean {
  const name = tag[0];
  if (name === undefined) {
    return false;
  }
  if (MANAGED_TAG_NAMES.has(name)) {
    return true;
  }
  if (name === "a") {
    return true;
  }
  if (
    name === "e" &&
    (tag[3] === GRANT_MARKER || tag[3] === INVENTORY_FOLD_MARKER)
  ) {
    return true;
  }
  return false;
}

/**
 * Turn a parsed inventory back into builder input without losing data.
 *
 * This is the safe rewrite path for kind:31633, and the one every writer should
 * use. Because the kind is addressable, publishing REPLACES the whole event:
 * anything the builder does not regenerate and the caller does not preserve is
 * destroyed permanently, for every other client too. Rebuilding by hand from a
 * few fields — `{ id, items }` — compiles, looks correct, and silently deletes
 * the contexts, grant references, content and unknown tags that other
 * applications wrote.
 *
 * Everything structured comes back through the typed fields, and every tag this
 * builder does not manage comes back through `preserveTags`.
 *
 * Spread the result to override fields, for example to add an item and bump the
 * revision:
 *
 * ```ts
 * const next = addInventoryItemQuantity(inventory, itemAddress, 1);
 * const unsigned = buildGameInventoryEvent({
 *   ...toBuildGameInventoryInput(next),
 *   revision: (next.revision ?? 0) + 1,
 * });
 * ```
 *
 * The fold manifest reference round-trips too. That is what keeps a rewrite
 * that folds nothing new from silently un-folding every spend in the chain.
 *
 * Note that only *valid* data round-trips. Item references the parser rejected
 * — a malformed address, a non-31632 coordinate, an invalid quantity — are not
 * republished, and duplicate references have already been resolved by the
 * parser's duplicate strategy. Both remain visible on `inventory.event.tags`
 * for repair workflows. This matches the kind:31634 round-trip exactly.
 */
export function toBuildGameInventoryInput(
  inventory: GameInventory,
): BuildGameInventoryInput {
  const result: BuildGameInventoryInput = {
    id: inventory.id,
    items: inventory.items.map((item) => ({
      address: item.address,
      relay: item.relay,
      quantity: item.quantity,
    })),
    contexts: [...inventory.contexts],
    grants: inventory.grants.map((grant) => ({
      eventId: grant.eventId,
      relay: grant.relay,
    })),
    // The raw content string passes through `serializeContent` verbatim.
    content: inventory.content,
    preserveTags: inventory.event.tags.map((tag) => [...tag]),
  };

  if (inventory.name !== undefined) {
    result.name = inventory.name;
  }
  if (inventory.alt !== undefined) {
    result.alt = inventory.alt;
  }
  if (inventory.revision !== undefined) {
    result.revision = inventory.revision;
  }
  if (inventory.fold !== undefined) {
    result.fold = {
      eventId: inventory.fold.eventId,
      relay: inventory.fold.relay,
    };
  }

  return result;
}
