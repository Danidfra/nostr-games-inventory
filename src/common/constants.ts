/**
 * Kind numbers defined by this library.
 *
 * - {@link KIND_GAME_ITEM_DEFINITION} (31632): Game Item Definition — what an
 *   item *is*.
 * - {@link KIND_GAME_INVENTORY} (31633): Game Inventory — which items are
 *   *held*, and how many.
 * - {@link KIND_GAME_ITEM_PLACEMENT} (31634): Game Item Placement — where
 *   referenced items are currently *equipped or placed*.
 *
 * These three responsibilities are separate: definition != ownership !=
 * placement.
 */
export const KIND_GAME_ITEM_DEFINITION = 31632 as const;
export const KIND_GAME_INVENTORY = 31633 as const;
export const KIND_GAME_ITEM_PLACEMENT = 31634 as const;

export type KindGameItemDefinition = typeof KIND_GAME_ITEM_DEFINITION;
export type KindGameInventory = typeof KIND_GAME_INVENTORY;
export type KindGameItemPlacement = typeof KIND_GAME_ITEM_PLACEMENT;
