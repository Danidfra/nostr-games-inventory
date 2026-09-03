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

It is a **consolidated snapshot**, not a ledger. Debits made by other applications between two snapshots are represented by separate, append-only `kind:1416` spend events, and are incorporated into the next snapshot through a `kind:1417` fold manifest. See [`docs/1416-1417-game-inventory-spend.md`](./1416-1417-game-inventory-spend.md) and [Optional fold reference](#optional-fold-reference).

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

### `d` is an opaque, application-defined inventory context

The `d` tag is an **opaque application-defined label for one inventory context**. It is not a globally shared inventory identifier, and this specification does not define, reserve, or recommend any particular value.

A player MAY own **any number** of `kind:31633` events with different `d` values, all valid at the same time. There is no canonical, primary, or default inventory. Generic shapes an application might use include:

```text
a game inventory
a backpack
a chest or other container
a character-specific inventory
a vault or bank
```

Applications decide, as their own policy and not as a protocol rule, which contexts they write, read, aggregate, display, and allow gameplay interactions with. Two applications MAY agree to share a context, and an application MAY keep a context to itself; the protocol distinguishes neither case.

Implementations MUST NOT assume that a player has exactly one inventory, and MUST NOT treat an unfamiliar `d` value as invalid.

### Discovering a player's inventories

Because `kind:31633` is addressable, a relay indexes it by author and kind. A client that knows only a pubkey can therefore enumerate **every** inventory that player owns, without knowing any `d` value in advance:

```json
{ "kinds": [31633], "authors": ["<pubkey>"] }
```

This returns the newest event for each distinct `d`. No separate index event is required, and none is defined.

Clients SHOULD prefer this query when displaying or aggregating what a player owns. Pinning a read to a single `#d` is a write-side convention leaking into the read side: it makes a client structurally unable to observe any inventory but its own.

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

`context` SHOULD be used for local filtering, UI grouping and metadata discovery.

Note that `context` is not a standard single-letter indexable tag, so relays are not expected to answer `#context` queries. Clients SHOULD fetch inventories by author, `#d` or `#a` and group by `context` locally. This is a documentation clarification only: the event model is unchanged.

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

## Optional fold reference

A `kind:31633` inventory MAY reference the `kind:1417` fold manifest whose spends its quantities already incorporate, using an `e` tag with the marker `fold`.

```json
["e", "<fold-manifest-id>", "<relay-url>", "fold"]
```

If the relay URL is unknown, the third element SHOULD be an empty string.

Its meaning is exact:

```text
The quantities in this snapshot already incorporate every kind:1416 spend
listed as `spend` in the referenced manifest and in every manifest reachable
through its `previous` chain; every spend listed as `void` anywhere in that
chain is permanently not applicable.
```

Readers that support spends therefore derive:

```text
effective balance = snapshot quantities − applicable spends not reachable through the fold chain
```

Rules:

- An inventory MUST NOT carry more than one fold reference. A permissive parser SHOULD keep the first and report a warning; a strict parser MAY reject.
- An inventory with **no** fold reference has incorporated no spend. Every valid spend against it is pending. This is the state of every inventory written before spends existed and of every inventory that has never folded; it is fully valid and MUST be parsed exactly as before.
- A snapshot that folds new spends MUST reference the new manifest. A snapshot that folds nothing new MUST keep referencing the manifest its base referenced. Dropping the reference makes every spend in the chain pending again and debits the owner a second time. The round-trip in [Preserving data a writer does not own](#preserving-data-a-writer-does-not-own) carries it over.
- A snapshot whose manifest cannot be retrieved MUST be reported as unresolved by spend-aware readers, which MUST NOT derive a balance from it by guessing. The raw quantities remain the owner's last consolidated statement.

### What the quantities mean once spends exist

The `a` tag quantities are the **last consolidated** ownership, written by the inventory's designated writer. Between two snapshots, `kind:1416` spends by the owner MAY make those quantities temporarily stale. Compliant spend-aware readers derive the effective quantities as above; clients unaware of `kind:1416` still see the last consolidated snapshot and may temporarily over-report an item that has pending spends, until the owner's next snapshot folds them. That is an accepted limitation of the version transition.

### One writer per context

The purpose of the spend model is that an application other than the inventory's owner-application never has to replace the snapshot: it debits with a spend and leaves the replacement to the context's designated writer. "One replacement writer per inventory context" is an application-level coordination convention that avoids lost updates between honest applications. It is not enforced by the protocol, which cannot stop a player (or a modified client holding their key) from replacing any of their own inventories.

### Relationship to `revision`

`revision` is unrelated to folds. It is not a lock, not compare-and-swap, not a spend order, and not evidence that any spend was folded, and it MUST NOT be reused as a spend checkpoint. A snapshot that folds spends is an ordinary replacement and follows the ordinary revision rules; whether it folded anything is stated by the fold reference alone.

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

A client that wants to verify inventory authenticity MAY compare the declared inventory against grant, spend, use, or conversion events. The spend event is `kind:1416`, defined in [`docs/1416-1417-game-inventory-spend.md`](./1416-1417-game-inventory-spend.md); grants remain undefined.

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

Partial changes, receipts, grants, spends, or conversions SHOULD be represented by separate regular events. For spends that separate event is `kind:1416`.

### Preserving data a writer does not own

Because a publish REPLACES the whole event, every tag and the `content` field are rewritten each time. Any data the writing application does not reproduce is destroyed permanently, for every other client as well as itself.

A client publishing an updated inventory therefore MUST preserve:

```text
item references it did not intend to change
context, name and alt tags
grant references
the fold reference
the content field
every tag it does not recognise
```

Unrecognised tags are the most easily lost and the most damaging to lose: another application may be using one to record state — a one-time allocation marker, a migration flag — whose meaning is invisible to the writer. A rewrite that drops such a tag can silently re-arm an operation that was meant to happen exactly once.

Clients SHOULD implement this as a round-trip: parse the newest event, apply the change to the parsed state, and rebuild from that state plus the original tags, rather than constructing a fresh event from the few fields the writer happens to care about.

## Optional revision

An inventory MAY carry an advisory revision counter.

```json
["revision", "<non-negative-integer>"]
```

The value MUST be a canonical non-negative decimal integer string. `"0"` is valid. Leading zeros, negative values, decimals, exponent notation and surrounding whitespace are invalid.

A writer that uses revisions reads the current inventory and publishes `previous + 1`. A writer that does not care MAY omit the tag entirely; the tag is OPTIONAL and its absence is normal.

### What a revision provides

It lets a **later reader** notice that two states disagree, instead of a lost update passing silently:

```text
two valid, different revisions   -> the states can be ordered
the same revision, different state -> a fork or a lost update occurred
```

### What a revision does NOT provide

```text
it is not a lock
it is not compare-and-swap
it does not prevent concurrent writes
it does not replace addressable-event resolution
it cannot detect anything against a peer that omits the tag
it does not define how to merge
```

Relays continue to keep the newest event per `(kind, pubkey, d)` regardless of any revision. Resolving a detected conflict is an application decision, and this specification continues to advise against merging item tags across versions.

### Comparing two states

Two states carrying the same valid revision SHOULD be treated as the same state only on hard evidence: the same event id, or byte-identical tags. Otherwise they SHOULD be reported as conflicting.

Implementations MUST NOT use `created_at` to break an equal-revision tie. Wall-clock timestamps are publisher- and clock-skew-controlled, so using one would silently pick a winner where the honest answer is "these two states conflict".

Implementations MUST NOT sort, normalize or re-derive tags before comparing them. Two tag lists that would normalize alike are still two different documents.

### Handling a malformed revision

A malformed `revision` value MUST NOT invalidate the inventory in permissive parsing. It SHOULD be ignored with a warning, leaving the revision absent — which comparison then reports as "unknown", the safe fallback. A strict-mode parser MAY reject the event.

Rejecting an entire inventory because a peer wrote a bad advisory counter would make every item a player owns disappear from every client, which is a far worse outcome than losing conflict detection for one revision.

## Conflict handling

If multiple `kind:31633` events exist for the same `owner-pubkey` and `d` tag, clients SHOULD use the newest valid event by `created_at`.

If two events have the same `created_at`, clients SHOULD retain the event with the lowest id in lexical order, which is the tie-breaking rule NIP-01 already defines for replaceable and addressable events. The previous wording ("clients MAY choose either one") is superseded: leaving the tie open invited two clients to disagree about the current inventory in exactly the case where agreement matters most.

Publishers SHOULD avoid the tie entirely by ensuring each replacement's `created_at` is strictly greater than that of the event it replaces.

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
a malformed revision tag (ignore it; do not reject the inventory)
a fold reference it cannot resolve (report it; do not guess a balance)
a blank fold reference (ignore it with a warning)
missing context
missing name
missing alt
empty content
valid JSON content it does not understand
invalid JSON content if operating in permissive mode
grant references it cannot resolve
```

## Tag summary

| Tag        | Required | Repeated | Description                                  |
| ---------- | -------- | -------- | -------------------------------------------- |
| `d`        | yes      | no       | Inventory context id (opaque, app-defined)   |
| `revision` | no       | no       | Advisory revision counter                    |
| `a`        | no       | yes      | Item reference and quantity                  |
| `context`  | no       | yes      | Game or inventory context                    |
| `name`     | no       | no       | Human-readable inventory name                |
| `alt`      | no       | no       | Human-readable fallback                      |
| `e`        | no       | yes      | Optional grant reference with marker `grant` |
| `e`        | no       | no       | Optional fold reference with marker `fold`   |

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

## `e` fold tag format

```json
["e", "<fold-manifest-id>", "<relay-url>", "fold"]
```

Field meanings:

| Index | Meaning                   |
| ----- | ------------------------- |
| `0`   | `"e"`                     |
| `1`   | Fold manifest event id    |
| `2`   | Relay URL or empty string |
| `3`   | Marker, always `"fold"`   |

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
  fold?: { eventId: string; relay: string };
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

// The safe rewrite path: turn a parsed inventory back into builder input so
// nothing the writer does not model is lost.
export function toBuildGameInventoryInput(
  inventory: GameInventory,
): BuildGameInventoryInput;

// Advisory conflict detection.
export function compareGameInventoryRevisions(
  current: { revision?: number; event?: { id?: string; tags?: string[][] } },
  incoming: { revision?: number; event?: { id?: string; tags?: string[][] } },
): "unknown" | "stale" | "equivalent" | "conflict" | "ahead";

// Discovery: omit `inventoryIds` to enumerate every context an owner has.
export function buildGameInventoryFilter(options?: {
  authors?: string[];
  inventoryIds?: string[];
  addresses?: string[];
}): { kinds: [31633]; authors?: string[]; "#d"?: string[]; "#a"?: string[] };
```

### The recommended write cycle

```ts
const base = parseGameInventory(newestEvent);
const next = addInventoryItemQuantity(base, itemAddress, 1);

const unsigned = buildGameInventoryEvent({
  ...toBuildGameInventoryInput(next), // carries unknown tags and content through
  revision: (next.revision ?? 0) + 1,
});
```

Reading the base immediately before building it is what keeps the replacement
honest; nothing in this specification makes that atomic, and the revision only
records the assumption so a later reader can check it.

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
Optional advisory revision: ["revision", "<non-negative-integer>"]
Inventory contexts per owner: many; d is opaque and application-defined
Discovery: {"kinds":[31633],"authors":["<pubkey>"]} returns them all
Optional grant references: ["e", "<grant-event-id>", "<relay-url>", "grant"]
Optional fold reference: ["e", "<fold-manifest-id>", "<relay-url>", "fold"], at most one
Content: empty by default, optional JSON metadata
Purpose: declare the last consolidated item ownership and quantities for one inventory context
Effective balance (spend-aware readers): snapshot − applicable kind:1416 spends not reachable through the fold chain
Not purpose: item definition, grant proof, placement, equipment, consumption, conversion
```
