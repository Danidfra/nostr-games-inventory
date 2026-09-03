/**
 * Kind numbers defined by this library.
 *
 * - {@link KIND_GAME_ITEM_DEFINITION} (31632): Game Item Definition — what an
 *   item *is*.
 * - {@link KIND_GAME_INVENTORY} (31633): Game Inventory — which items are
 *   *held*, and how many.
 * - {@link KIND_GAME_ITEM_PLACEMENT} (31634): Game Item Placement — where
 *   referenced items are currently *equipped or placed*.
 * - {@link KIND_GAME_INVENTORY_SPEND} (1416): Game Inventory Spend — an
 *   append-only, owner-signed *debit* against one kind:31633 inventory.
 * - {@link KIND_GAME_INVENTORY_FOLD} (1417): Game Inventory Fold Manifest — an
 *   append-only record of exactly which spends a kind:31633 snapshot has
 *   *incorporated*.
 *
 * The three addressable responsibilities are separate: definition !=
 * ownership != placement. The two regular kinds are the append-only side of
 * ownership: a snapshot is replaced, a spend or a fold is only ever added.
 */
export const KIND_GAME_ITEM_DEFINITION = 31632 as const;
export const KIND_GAME_INVENTORY = 31633 as const;
export const KIND_GAME_ITEM_PLACEMENT = 31634 as const;
export const KIND_GAME_INVENTORY_SPEND = 1416 as const;
export const KIND_GAME_INVENTORY_FOLD = 1417 as const;

export type KindGameItemDefinition = typeof KIND_GAME_ITEM_DEFINITION;
export type KindGameInventory = typeof KIND_GAME_INVENTORY;
export type KindGameItemPlacement = typeof KIND_GAME_ITEM_PLACEMENT;
export type KindGameInventorySpend = typeof KIND_GAME_INVENTORY_SPEND;
export type KindGameInventoryFold = typeof KIND_GAME_INVENTORY_FOLD;
