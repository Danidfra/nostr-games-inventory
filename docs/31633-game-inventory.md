# NIP-XX

## Game Inventory

`draft` `optional`

This NIP defines `kind:31633`, an addressable event used to represent a game inventory.

A game inventory event declares which game item definitions a user currently holds inside a specific inventory context, such as a game inventory, character inventory, chest, house, world, or container.

## Event kind

`31633` is an addressable event.

The inventory address is:

```text
31633:<owner-pubkey>:<d-tag>
```

The event author is the inventory owner.

## Purpose

A `kind:31633` event answers:

```text
Which items does this user currently hold in this inventory context?
```

It does not define the item. Item definitions are defined by `kind:31632`.

It does not prove that the user received the item from an official source. Grants or receipts are represented by a separate grant event.

It does not describe where an item is equipped or placed. Equipment and placement are represented by game-specific state or by a separate placement event.

## Inventory identity

The `d` tag identifies the inventory context.

```json
["d", "<inventory-id>"]
```

The `d` value SHOULD be stable.

Examples:

```json
["d", "game:blobbi"]
["d", "game:blobbi-island"]
["d", "character:blobbi:blobbi-abc123"]
["d", "chest:blobbi-island:home"]
["d", "house:blobbi-island:main"]
```

Clients SHOULD treat the latest event for the same `31633:<owner-pubkey>:<d-tag>` as the current inventory state.

## Required tags

### `d`

The `d` tag is REQUIRED.

```json
["d", "<inventory-id>"]
```

An event without a valid non-empty `d` tag MUST NOT be treated as a valid `kind:31633` inventory.

## Item references

Inventory items are represented with `a` tags that reference `kind:31632` item definitions.

```json
["a", "31632:<issuer-pubkey>:<item-d-tag>", "<relay-url>", "<quantity>"]
```

If the relay URL is unknown, the third element SHOULD be an empty string.

```json
["a", "31632:<issuer-pubkey>:<item-d-tag>", "", "<quantity>"]
```

Example:

```json
["a", "31632:pubkey123:blobbi:food:carrot", "", "3"]
```

This means:

```text
The owner of this inventory declares that they hold 3 units of the item
31632:pubkey123:blobbi:food:carrot in this inventory context.
```

### Why `a` tags are used

The `a` tag is used so relays and clients can discover inventories referencing a given item using `#a` filters.

Example filter:

```json
{
  "kinds": [31633],
  "#a": ["31632:pubkey123:blobbi:food:carrot"]
}
```

## Quantity

The fourth element of an inventory `a` tag MUST be the item quantity.

```json
["a", "<item-address>", "<relay-url>", "<quantity>"]
```

Quantity MUST be encoded as a decimal integer string.

Valid examples:

```json
["a", "31632:pubkey123:blobbi:food:carrot", "", "1"]
["a", "31632:pubkey123:blobbi:food:carrot", "", "99"]
["a", "31632:pubkey123:blobbi:food:carrot", "", "1000"]
```

Invalid examples:

```json
["a", "31632:pubkey123:blobbi:food:carrot", "", "0"]
["a", "31632:pubkey123:blobbi:food:carrot", "", "-1"]
["a", "31632:pubkey123:blobbi:food:carrot", "", "1.5"]
["a", "31632:pubkey123:blobbi:food:carrot", "", "abc"]
```

If an item quantity becomes `0`, the item tag SHOULD be omitted when publishing the next inventory event.

Parsers SHOULD ignore item references with quantity `0`, negative quantities, non-integer quantities, or missing quantities.

## Empty inventories

An inventory MAY contain no item references.

This is a valid empty inventory:

```json
{
  "kind": 31633,
  "content": "",
  "tags": [["d", "game:blobbi"]]
}
```

This allows clients to intentionally publish an empty inventory context.

## Recommended tags

### `context`

The `context` tag describes the game, world, container type, or usage context of the inventory.

```json
["context", "<context>"]
```

Examples:

```json
["context", "game:blobbi"]
["context", "game:blobbi-island"]
["context", "chest:blobbi-island"]
["context", "character:blobbi"]
```

`context` SHOULD be used for filtering and UI grouping.

The `d` tag identifies the specific inventory. The `context` tag identifies the broader category.

Example:

```json
["d", "chest:blobbi-island:home"]
["context", "chest:blobbi-island"]
```

### `name`

The `name` tag is a human-readable inventory name.

```json
["name", "<display-name>"]
```

Examples:

```json
["name", "Blobbi Inventory"]
["name", "Home Chest"]
["name", "Backpack"]
```

### `alt`

The `alt` tag SHOULD provide a human-readable fallback for clients that do not understand `kind:31633`.

```json
["alt", "Game inventory: Blobbi"]
```

The `alt` tag is OPTIONAL.

## Optional grant references

A `kind:31633` inventory MAY reference grant or receipt events using `e` tags with the marker `grant`.

```json
["e", "<grant-event-id>", "<relay-url>", "grant"]
```

If the relay URL is unknown, the third element SHOULD be an empty string.

```json
["e", "<grant-event-id>", "", "grant"]
```

Grant references are optional.

Clients MUST NOT require grant references in order to parse an inventory.

Grant references MAY be used by clients to audit whether an inventory is backed by issuer-signed grants.

## Content

The `content` field SHOULD be empty by default.

```json
"content": ""
```

Clients MUST read item ownership and quantities from tags.

The `content` field MAY contain JSON metadata for UI or local display preferences, but it MUST NOT be required to reconstruct the inventory.

Example optional content:

```json
{
  "sort": "category",
  "view": "grid",
  "collapsedCategories": ["materials"]
}
```

Clients that do not understand the `content` JSON MUST still be able to parse the inventory from tags alone.

If the content is JSON, it SHOULD be a JSON object.

## Example: Blobbi inventory

```json
{
  "kind": 31633,
  "content": "",
  "tags": [
    ["d", "game:blobbi"],
    ["context", "game:blobbi"],
    ["name", "Blobbi Inventory"],
    ["a", "31632:pubkey123:blobbi:food:carrot", "", "3"],
    ["a", "31632:pubkey123:blobbi:cosmetic:wizard_hat", "", "1"],
    ["alt", "Game inventory: Blobbi"]
  ]
}
```

## Example: chest inventory

```json
{
  "kind": 31633,
  "content": "",
  "tags": [
    ["d", "chest:blobbi-island:home"],
    ["context", "chest:blobbi-island"],
    ["name", "Home Chest"],
    ["a", "31632:pubkey123:blobbi:material:wood", "", "25"],
    ["a", "31632:pubkey123:blobbi:material:stone", "", "12"],
    ["alt", "Game inventory: Home Chest"]
  ]
}
```

## Example: empty inventory

```json
{
  "kind": 31633,
  "content": "",
  "tags": [
    ["d", "game:blobbi"],
    ["context", "game:blobbi"],
    ["name", "Blobbi Inventory"],
    ["alt", "Empty game inventory: Blobbi"]
  ]
}
```

## Example: inventory with grant references

```json
{
  "kind": 31633,
  "content": "",
  "tags": [
    ["d", "game:blobbi"],
    ["context", "game:blobbi"],
    ["name", "Blobbi Inventory"],
    ["a", "31632:pubkey123:blobbi:food:carrot", "", "3"],
    ["e", "grantEventId123", "", "grant"],
    ["alt", "Game inventory: Blobbi"]
  ]
}
```

## Trust model

A `kind:31633` event is a user-declared inventory state.

By itself, it does not prove that the items were granted by an official game, issuer, or server.

A game MAY accept self-declared inventories.

A game MAY require grant verification.

A game MAY accept only items from trusted issuers.

A game MAY reject items from unknown issuers.

Clients SHOULD treat inventory state and grant verification as separate concerns.

## Verification model

A client that wants to verify inventory authenticity MAY compare the declared inventory against grant, spend, use, or conversion events.

For example:

```text
verified balance = grants - spends
declared balance = quantity in kind:31633
```

If the verified balance matches the declared balance, a client MAY display the item as verified.

If the verified balance does not match the declared balance, a client MAY display the item as unverified, self-declared, or invalid.

The verification model is intentionally optional so casual games can remain simple while stricter games can enforce official item provenance.

## Update rules

Because `kind:31633` is addressable, clients SHOULD treat the newest event for the same inventory address as the current inventory.

Inventory address:

```text
31633:<owner-pubkey>:<d-tag>
```

When publishing an updated inventory, clients SHOULD include the complete current item state for that inventory.

Clients SHOULD NOT publish partial inventory diffs using `kind:31633`.

Partial changes, receipts, grants, spends, or conversions SHOULD be represented by separate regular events.

## Conflict handling

If multiple `kind:31633` events exist for the same `owner-pubkey` and `d` tag, clients SHOULD use the newest valid event by `created_at`.

If two events have the same `created_at`, clients MAY choose either one or use implementation-specific tie-breaking.

Clients SHOULD NOT merge item tags across multiple versions of the same inventory address unless implementing a custom recovery tool.

## Duplicate item references

A valid inventory SHOULD NOT contain multiple `a` tags for the same item address.

If duplicate item references are found, parsers SHOULD either:

```text
use the last valid quantity
sum valid quantities
reject the inventory in strict mode
```

Recommended default behavior:

```text
use the last valid quantity
```

A library SHOULD expose strict mode for clients that want to reject duplicates.

## Privacy

`kind:31633` is public by default.

A public inventory exposes item addresses and quantities to relays and clients.

Private or encrypted inventories are out of scope for this version.

A future version MAY define encrypted inventory contents, but encrypted inventories reduce indexability and cross-game interoperability.

## Validation rules

A client or library MUST reject a `kind:31633` inventory if:

```text
kind is not 31633
d tag is missing
d tag is empty
```

A client or library SHOULD ignore an item reference if:

```text
the tag is not an a tag
the a tag does not reference kind 31632
the item address is malformed
quantity is missing
quantity is not a non-negative integer string
quantity is 0
quantity is negative
quantity is decimal
```

A client or library SHOULD tolerate:

```text
unknown tags
missing context
missing name
missing alt
empty content
valid JSON content it does not understand
invalid JSON content if operating in permissive mode
grant references it cannot resolve
```

## Tag summary

| Tag       | Required | Repeated | Description                                  |
| --------- | -------- | -------- | -------------------------------------------- |
| `d`       | yes      | no       | Inventory id                                 |
| `a`       | no       | yes      | Item reference and quantity                  |
| `context` | no       | yes      | Game or inventory context                    |
| `name`    | no       | no       | Human-readable inventory name                |
| `alt`     | no       | no       | Human-readable fallback                      |
| `e`       | no       | yes      | Optional grant reference with marker `grant` |

## `a` tag format

```json
["a", "31632:<issuer-pubkey>:<item-d-tag>", "<relay-url>", "<quantity>"]
```

Field meanings:

| Index | Meaning                   |
| ----- | ------------------------- |
| `0`   | `"a"`                     |
| `1`   | Item address              |
| `2`   | Relay URL or empty string |
| `3`   | Quantity                  |

## `e` grant tag format

```json
["e", "<grant-event-id>", "<relay-url>", "grant"]
```

Field meanings:

| Index | Meaning                   |
| ----- | ------------------------- |
| `0`   | `"e"`                     |
| `1`   | Grant event id            |
| `2`   | Relay URL or empty string |
| `3`   | Marker, always `"grant"`  |

## Library functions

A `@nostr-games/inventory` package SHOULD expose helpers similar to:

```ts
export const KIND_GAME_INVENTORY = 31633;

export interface GameInventoryItem {
  address: string;
  relay?: string;
  quantity: number;
}

export interface GameInventory {
  id: string;
  address: string;
  owner: string;
  contexts: string[];
  name?: string;
  items: GameInventoryItem[];
  grantEventIds: string[];
  content?: unknown;
  event: NostrEvent;
}

export function parseGameInventory(event: NostrEvent): GameInventory | null;

export function buildGameInventoryEvent(input: BuildGameInventoryInput): {
  kind: 31633;
  content: string;
  tags: string[][];
};

export function buildGameInventoryAddress(
  ownerPubkey: string,
  inventoryId: string,
): string;

export function parseGameInventoryAddress(address: string): {
  kind: 31633;
  pubkey: string;
  inventoryId: string;
} | null;

export function addInventoryItem(
  inventory: GameInventory,
  itemAddress: string,
  quantity: number,
): GameInventory;

export function removeInventoryItem(
  inventory: GameInventory,
  itemAddress: string,
  quantity: number,
): GameInventory;

export function setInventoryItemQuantity(
  inventory: GameInventory,
  itemAddress: string,
  quantity: number,
): GameInventory;
```

## Final decisions for kind 31633

```text
Kind: 31633
Name: Game Inventory
Type: addressable
Author: inventory owner
Identity: 31633:<owner-pubkey>:<d>
Required tags: d
Item tags: ["a", "31632:<issuer-pubkey>:<item-d-tag>", "<relay-url>", "<quantity>"]
Recommended tags: context, name, alt
Optional grant references: ["e", "<grant-event-id>", "<relay-url>", "grant"]
Content: empty by default, optional JSON metadata
Purpose: declare item ownership and quantities for one inventory context
Not purpose: item definition, grant proof, placement, equipment, consumption, conversion
```
