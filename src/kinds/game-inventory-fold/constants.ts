import {
  KIND_GAME_INVENTORY_FOLD,
  type KindGameInventoryFold,
} from "../../common/constants.js";

export { KIND_GAME_INVENTORY_FOLD, type KindGameInventoryFold };

/**
 * The marker used on a kind:1417 `e` tag to reference the previous fold
 * manifest of the same inventory:
 * `["e", "<previous-fold-id>", "<relay-url>", "previous"]`.
 */
export const FOLD_PREVIOUS_MARKER = "previous" as const;

/**
 * The marker used on a kind:1417 `e` tag to reference an applied spend that
 * the snapshot has incorporated:
 * `["e", "<spend-id>", "<relay-url>", "spend"]`.
 */
export const FOLD_SPEND_MARKER = "spend" as const;

/**
 * The marker used on a kind:1417 `e` tag to reference a rejected spend that
 * the owner has settled as permanently not applicable:
 * `["e", "<spend-id>", "<relay-url>", "void"]`.
 */
export const FOLD_VOID_MARKER = "void" as const;
