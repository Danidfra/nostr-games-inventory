import type { UnsignedEventTemplate } from "../../nostr/event.js";
import {
  KIND_GAME_INVENTORY_SPEND,
  KIND_GAME_INVENTORY,
  KIND_GAME_ITEM_DEFINITION,
  type KindGameInventorySpend,
} from "../../common/constants.js";
import { serializeContent } from "../../common/json.js";
import { isBlank } from "../../common/strings.js";
import {
  INVENTORY_MARKER,
  parseGameInventoryAddress,
} from "../game-inventory/address.js";
import { parseGameItemAddress } from "../game-item-definition/address.js";
import { encodeInventoryQuantity } from "../game-inventory/quantity.js";
import { SPEND_ITEM_MARKER, SPEND_QUANTITY_TAG } from "./constants.js";
import type { BuildGameInventorySpendInput } from "./types.js";

const MANAGED_TAG_NAMES = new Set<string>([
  "a",
  SPEND_QUANTITY_TAG,
  "purpose",
  "client",
  "nonce",
  "alt",
]);

/**
 * Build an unsigned kind:1416 Game Inventory Spend template.
 *
 * The builder:
 * - requires a full `31633:<owner>:<d>` inventory address and a full
 *   `31632:<issuer>:<d>` item address (never a bare `d`);
 * - requires `quantity` to be a positive safe integer; `0`, negatives,
 *   decimals, `NaN`, `Infinity` and unsafe integers throw and are never
 *   floored, clamped or dropped;
 * - emits optional metadata only when non-blank, never normalized;
 * - never creates `id` or `sig`, and never decides who signs. The signer MUST
 *   be the inventory owner named in `inventoryAddress`; a spend signed by
 *   anyone else is rejected by every compliant parser.
 *
 * Emitted tag order is fixed and deterministic:
 *
 * ```text
 * a(inventory) -> a(item) -> quantity -> purpose -> client -> nonce -> alt
 *   -> extraTags
 * ```
 *
 * A retry of an ambiguous publish SHOULD republish the same signed event, not
 * build a new one: the event id is the spend's identity.
 *
 * @throws {Error} for an invalid inventory or item address, an invalid
 * quantity, or an `extraTags` entry that conflicts with a managed tag.
 */
export function buildGameInventorySpendEvent(
  input: BuildGameInventorySpendInput,
): UnsignedEventTemplate<KindGameInventorySpend> {
  if (parseGameInventoryAddress(input.inventoryAddress) === null) {
    throw new Error(
      `buildGameInventorySpendEvent: \`inventoryAddress\` must be a kind:${KIND_GAME_INVENTORY} coordinate, got: ${String(input.inventoryAddress)}`,
    );
  }
  if (parseGameItemAddress(input.itemAddress) === null) {
    throw new Error(
      `buildGameInventorySpendEvent: \`itemAddress\` must be a kind:${KIND_GAME_ITEM_DEFINITION} coordinate, got: ${String(input.itemAddress)}`,
    );
  }
  if (
    typeof input.quantity !== "number" ||
    !Number.isSafeInteger(input.quantity) ||
    input.quantity <= 0
  ) {
    throw new Error(
      `buildGameInventorySpendEvent: \`quantity\` must be a positive safe integer, got: ${String(input.quantity)}`,
    );
  }

  const tags: string[][] = [
    ["a", input.inventoryAddress, input.inventoryRelay ?? "", INVENTORY_MARKER],
    ["a", input.itemAddress, input.itemRelay ?? "", SPEND_ITEM_MARKER],
    [SPEND_QUANTITY_TAG, encodeInventoryQuantity(input.quantity)],
  ];

  pushMetadata(tags, "purpose", input.purpose);
  pushMetadata(tags, "client", input.client);
  pushMetadata(tags, "nonce", input.nonce);
  pushMetadata(tags, "alt", input.alt);

  for (const tag of input.extraTags ?? []) {
    const name = tag[0];
    if (name !== undefined && MANAGED_TAG_NAMES.has(name)) {
      throw new Error(
        `buildGameInventorySpendEvent: \`extraTags\` may not contain the builder-managed tag \`${name}\``,
      );
    }
    tags.push([...tag]);
  }

  return {
    kind: KIND_GAME_INVENTORY_SPEND,
    content: serializeContent(input.content),
    tags,
  };
}

function pushMetadata(
  tags: string[][],
  name: string,
  value: string | undefined,
): void {
  if (value !== undefined && !isBlank(value)) {
    tags.push([name, value]);
  }
}
