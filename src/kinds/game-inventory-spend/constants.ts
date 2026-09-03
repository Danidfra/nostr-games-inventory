import {
  KIND_GAME_INVENTORY_SPEND,
  type KindGameInventorySpend,
} from "../../common/constants.js";

export { KIND_GAME_INVENTORY_SPEND, type KindGameInventorySpend };

/**
 * The marker used on a kind:1416 `a` tag to reference the debited item:
 * `["a", "31632:<issuer-pubkey>:<item-d-tag>", "<relay-url>", "item"]`.
 */
export const SPEND_ITEM_MARKER = "item" as const;

/**
 * The tag carrying the debited quantity: `["quantity", "<positive-integer>"]`.
 */
export const SPEND_QUANTITY_TAG = "quantity" as const;
