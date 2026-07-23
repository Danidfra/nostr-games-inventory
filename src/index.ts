/**
 * @nostr-games/inventory
 *
 * Framework-independent TypeScript library implementing:
 * - kind:31632 Game Item Definition
 * - kind:31633 Game Inventory
 *
 * Pure functions only, no import-time side effects.
 */

// Nostr event types
export type { NostrEvent, UnsignedEventTemplate } from "./nostr/event.js";

// Kind constants
export {
  KIND_GAME_ITEM_DEFINITION,
  KIND_GAME_INVENTORY,
  type KindGameItemDefinition,
  type KindGameInventory,
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
