/**
 * Kind numbers defined by this library.
 *
 * - {@link KIND_GAME_ITEM_DEFINITION} (31632): Game Item Definition.
 * - {@link KIND_GAME_INVENTORY} (31633): Game Inventory.
 */
export const KIND_GAME_ITEM_DEFINITION = 31632 as const;
export const KIND_GAME_INVENTORY = 31633 as const;

export type KindGameItemDefinition = typeof KIND_GAME_ITEM_DEFINITION;
export type KindGameInventory = typeof KIND_GAME_INVENTORY;
