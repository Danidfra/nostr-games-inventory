/**
 * @nostr-games/inventory
 *
 * Framework-independent TypeScript library implementing:
 * - kind:31632 Game Item Definition — what an item is
 * - kind:31633 Game Inventory — which items are held, and how many
 * - kind:31634 Game Item Placement — where items are equipped or placed
 * - kind:1416 Game Inventory Spend — an append-only, owner-signed debit
 *   against one inventory
 * - kind:1417 Game Inventory Fold Manifest — an append-only record of which
 *   spends a snapshot has incorporated
 *
 * These are separate responsibilities:
 * definition != ownership != placement, and snapshot != spend != fold.
 *
 * Pure functions only, no import-time side effects. Nothing here signs,
 * publishes, fetches, or decides whether a placement is authorized.
 */

// Nostr event types
export type { NostrEvent, UnsignedEventTemplate } from "./nostr/event.js";

// Kind constants
export {
  KIND_GAME_ITEM_DEFINITION,
  KIND_GAME_INVENTORY,
  KIND_GAME_ITEM_PLACEMENT,
  KIND_GAME_INVENTORY_SPEND,
  KIND_GAME_INVENTORY_FOLD,
  type KindGameItemDefinition,
  type KindGameInventory,
  type KindGameItemPlacement,
  type KindGameInventorySpend,
  type KindGameInventoryFold,
} from "./common/constants.js";

// Shared parse result / mode types
export type {
  ParseMode,
  ParseResult,
  ParseWarning,
  ParseWarningCode,
} from "./common/result.js";

// Shared addressable-event helpers
export {
  buildAddressableEventAddress,
  parseAddressableEventAddress,
  type AddressableEventAddress,
  type AddressParseOptions,
} from "./common/address.js";

// Shared tag helpers
export { getDTag, getTagValue, getTagValues } from "./common/tags.js";

// Shared content JSON helpers
export {
  parseContentJson,
  serializeContent,
  type ContentParseResult,
} from "./common/json.js";

// kind:31632 Game Item Definition
export * from "./kinds/game-item-definition/index.js";

// kind:31633 Game Inventory
export * from "./kinds/game-inventory/index.js";

// kind:31634 Game Item Placement
export * from "./kinds/game-item-placement/index.js";

// kind:1416 Game Inventory Spend
export * from "./kinds/game-inventory-spend/index.js";

// kind:1417 Game Inventory Fold Manifest
export * from "./kinds/game-inventory-fold/index.js";
