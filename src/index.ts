/**
 * @nostr-games/inventory
 *
 * Framework-independent TypeScript library implementing:
 * - kind:31632 Game Item Definition — what an item is
 * - kind:31633 Game Inventory — which items are held, and how many
 * - kind:31634 Game Item Placement — where items are equipped or placed
 *
 * These are three separate responsibilities:
 * definition != ownership != placement.
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
  type KindGameItemDefinition,
  type KindGameInventory,
  type KindGameItemPlacement,
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
