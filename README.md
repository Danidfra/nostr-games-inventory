# @nostr-games/inventory

Framework-independent TypeScript library implementing two Nostr event kinds for
games:

- **`kind:31632`** — Game Item Definition
- **`kind:31633`** — Game Inventory

It provides constants, types, parsers, builders, validators and helpers for
these kinds. It is pure, has no import-time side effects, no framework or
application dependencies, and works in both browser and Node environments.

> Status: `private` (not published to npm). This is the protocol layer only.
> No React, hooks, UI, relay clients, signers, encryption, grants, placement,
> equipment, persistence, or publishing are included in this phase.

## Design principles

- **TypeScript-first**, strict compiler settings, no `any` casts.
- **Pure functions**, no global/module side effects.
- **Tags are the source of truth.** `content` is optional metadata and never
  required to reconstruct an item or inventory.
- **No heavy dependencies.** The only Nostr type used is a minimal local
  structural `NostrEvent` interface, so any compatible event object (e.g. from
  `nostr-tools`) can be passed in without adding a dependency.

## Install (local / workspace only)

```bash
pnpm install
pnpm run build
```

## Public API

### Constants

```ts
KIND_GAME_ITEM_DEFINITION; // 31632
KIND_GAME_INVENTORY; // 31633
```

### Nostr types

```ts
interface NostrEvent {
  id;
  pubkey;
  created_at;
  kind;
  tags;
  content;
  sig;
}
interface UnsignedEventTemplate<K> {
  kind: K;
  content: string;
  tags: string[][];
}
```

Builders return an `UnsignedEventTemplate`. They never create `id` or `sig`
and never sign. `pubkey` / `created_at` are added by your signing layer.

### Address helpers

```ts
buildAddressableEventAddress(kind, pubkey, identifier): string
parseAddressableEventAddress(address, options?): AddressableEventAddress | null

buildGameItemAddress(pubkey, itemId): string
parseGameItemAddress(address, options?): GameItemAddress | null

buildGameInventoryAddress(ownerPubkey, inventoryId): string
parseGameInventoryAddress(address, options?): GameInventoryAddress | null

getDTag(event | tags): string | undefined
```

Addresses are `<kind>:<pubkey>:<d>`. **The `d` component may contain colons**
(e.g. `blobbi:food:carrot`), so parsing splits only on the first two colons and
treats the remainder as the identifier.

By default the pubkey segment may be any non-empty string (the specs use
placeholder pubkeys like `pubkey123`). Pass `{ requireHexPubkey: true }` to
require a 64-char lowercase-hex pubkey.

### Kind 31632 — Game Item Definition

```ts
parseGameItemDefinition(event, options?): GameItemDefinition | null
parseGameItemDefinitionResult(event, options?): ParseResult<GameItemDefinition>
buildGameItemDefinitionEvent(input): UnsignedEventTemplate<31632>
validateGameItemDefinition(event, options?): ItemDefinitionValidationResult
```

### Kind 31633 — Game Inventory

```ts
parseGameInventory(event, options?): GameInventory | null
parseGameInventoryResult(event, options?): ParseResult<GameInventory>
buildGameInventoryEvent(input): UnsignedEventTemplate<31633>
validateGameInventory(event, options?): InventoryValidationResult
```

### Quantity helpers

```ts
parseInventoryQuantity(raw): number | null      // positive integer strings only
getInventoryItemQuantity(inventory, itemAddress): number
setInventoryItemQuantity(inventory, itemAddress, quantity, relay?): GameInventory
addInventoryItemQuantity(inventory, itemAddress, amount, relay?): GameInventory
removeInventoryItemQuantity(inventory, itemAddress, amount): GameInventory
```

All inventory helpers are **immutable**: they return a new `GameInventory` and
never mutate the input.

## Parsing behavior: modes and results

Every parser accepts a `mode`:

- **`permissive`** (default) — follows the specs' "SHOULD tolerate" rules.
  Unknown tags are kept, invalid item tags are ignored, invalid JSON `content`
  does not block tag parsing, duplicate inventory items resolve using the
  recommended default (`last` valid quantity).
- **`strict`** — rejects the event where the specs allow rejection: invalid
  JSON `content`, and duplicate item references (see below).

"MUST reject" conditions (wrong kind, missing/empty `d`, missing required
`31632` tags) reject the event in **both** modes.

Parsers come in two flavors so failures are never silently hidden:

- `parseX(...) => X | null` — convenience.
- `parseXResult(...) => ParseResult<X>` — structured result exposing:
  - `ok: false` + `error` for a **rejected event**;
  - `ok: true` + `value` for a valid event, plus `warnings[]` describing
    **valid events with invalid tags that were ignored** and other recoverable
    issues (e.g. `invalid-quantity`, `malformed-address`,
    `wrong-referenced-kind`, `invalid-json-content`, `duplicate-item`).

### Content JSON

For both kinds, `content` is preserved verbatim on the parsed object
(`.content`). If it is non-empty valid JSON it is also exposed as
`.contentJson`. Invalid JSON in permissive mode yields a warning, not a
rejection. JSON is only required if you opt in via `requireJsonContent` (or use
`strict` mode). Builders accept either a preserialized string or any
JSON-serializable value for `content`.

## Duplicate inventory items

The 31633 spec allows three strategies for duplicate `a` tag addresses. This
library implements all three explicitly via `duplicateStrategy`:

| Strategy | Behavior                     | Default in      |
| -------- | ---------------------------- | --------------- |
| `last`   | keep the last valid quantity | permissive mode |
| `sum`    | sum all valid quantities     | (opt-in)        |
| `strict` | reject the inventory         | strict mode     |

`last` is the spec's recommended default, so it is the default in permissive
parsing and in `buildGameInventoryEvent`.

## Builders

Builders:

- validate input before generating anything (throw on empty `id`/`name`/`type`
  or invalid item addresses);
- produce unsigned templates (`{ kind, content, tags }`), never `id`/`sig`;
- normalize quantities (floor, clamp) and **omit zero-quantity items**;
- emit tags in a **stable, deterministic order** to simplify testing;
- never duplicate the tags they manage; `extraTags` are appended verbatim.

## Example

```ts
import {
  buildGameItemDefinitionEvent,
  buildGameItemAddress,
  buildGameInventoryEvent,
  parseGameInventory,
  addInventoryItemQuantity,
} from "@nostr-games/inventory";

// Define an item
const carrot = buildGameItemDefinitionEvent({
  id: "blobbi:food:carrot",
  name: "Carrot",
  type: "consumable",
  category: "food",
  topics: ["edible"],
  content: { description: "A crunchy carrot." },
});

// Start from an empty inventory event, add 3 carrots, rebuild.
const carrotAddr = buildGameItemAddress(
  "<issuer-pubkey>",
  "blobbi:food:carrot",
);
const empty = buildGameInventoryEvent({ id: "game:blobbi" });
const inv = parseGameInventory({
  ...empty,
  id: "",
  pubkey: "<owner>",
  created_at: 0,
  sig: "",
})!;
const updated = addInventoryItemQuantity(inv, carrotAddr, 3);
const nextEvent = buildGameInventoryEvent({
  id: updated.id,
  items: updated.items,
});
```

## Ambiguities found in the specifications

These were resolved explicitly rather than silently:

1. **`d` values contain colons.** The recommended `d` format
   `namespace:category:slug` means full addresses have more than three
   colon-separated parts. Address parsing therefore treats everything after the
   second colon as the identifier.
2. **Pubkey format.** The spec examples use non-hex placeholders. Address
   parsing accepts any non-empty pubkey by default; strict hex validation is
   opt-in (`requireHexPubkey`).
3. **`based_on` marker vs. quantity slot.** In `31632`, an `a` tag's index-3
   slot is the `based_on` marker; in `31633` the same slot is the quantity.
   These are handled per-kind and never conflated.
4. **Ignore vs. reject.** For `31633`, malformed/invalid item references are
   _ignored_ (parse still succeeds) while missing/empty `d` or wrong `kind`
   _rejects_ the whole event. These are surfaced as warnings vs. errors.
5. **Duplicate items.** Default `last`, with `sum` and `strict` available, per
   the spec's three allowed strategies.
6. **Invalid JSON `content`.** Only rejected when JSON is required
   (`requireJsonContent` / strict mode); otherwise a warning.

## Project structure

```
src/
  index.ts                       # public barrel export
  nostr/event.ts                 # NostrEvent, UnsignedEventTemplate
  common/
    constants.ts                 # KIND_* constants
    address.ts                   # addressable address parse/build
    tags.ts                      # getDTag, getTagValue(s)
    json.ts                      # content JSON parse/serialize
    result.ts                    # ParseMode / ParseResult / warnings
  kinds/
    game-item-definition/        # kind 31632
      { types, constants via common, address, validate, parse, build, index }
    game-inventory/              # kind 31633
      { types, address, quantity, validate, parse, build, helpers, index }
test/                            # vitest suites
```

## Scripts

```bash
pnpm run typecheck   # tsc --noEmit
pnpm run lint        # eslint
pnpm run format      # prettier --write
pnpm run test        # vitest run
pnpm run build       # tsup (ESM + CJS + d.ts)
pnpm run check       # all of the above
```

## Tooling

- **pnpm** — package manager
- **TypeScript** (strict) — language + typecheck
- **tsup** (esbuild) — build to ESM + CJS + type declarations
- **vitest** — tests
- **ESLint** (typescript-eslint, type-checked) + **Prettier** — lint/format

## License

MIT
