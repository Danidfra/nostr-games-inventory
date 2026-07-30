# @nostr-games/inventory

Framework-independent TypeScript library implementing two Nostr event kinds for
games:

- **`kind:31632`** — Game Item Definition
- **`kind:31633`** — Game Inventory

It provides constants, types, parsers, builders, validators and helpers for
these kinds. It is pure, has no import-time side effects, no framework or
application dependencies, and works in both browser and Node environments.

> Status: published to npm. This is the protocol layer only. No React, hooks,
> UI, relay clients, signers, encryption, grants, placement, equipment,
> persistence, or publishing are included in this phase.

## Design principles

- **TypeScript-first**, strict compiler settings, no `any` casts.
- **Pure functions**, no global/module side effects.
- **Tags are the source of truth.** `content` is optional metadata and never
  required to reconstruct an item or inventory.
- **No heavy dependencies.** The only Nostr type used is a minimal local
  structural `NostrEvent` interface, so any compatible event object (e.g. from
  `nostr-tools`) can be passed in without adding a dependency.

## Install

```bash
pnpm add @nostr-games/inventory
# or: npm i @nostr-games/inventory
```

Ships ESM + CJS + type declarations; no runtime dependencies. Node >= 18.

To work on the library itself:

```bash
pnpm install
pnpm run build
```

See [CHANGELOG.md](./CHANGELOG.md) for release notes.

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

#### Item images

`image` is a repeatable tag. An `image` tag with no marker is the primary
(default) image; an `image` tag with a third element carries a **view marker**:

```json
["image", "https://ex.com/hat.png"]
["image", "https://ex.com/hat-front.png", "front"]
```

Markers defined by this version (`GAME_ITEM_IMAGE_MARKERS`): `front`,
`side-right`, `side-left`, `back`, `diagonal-front-right`,
`diagonal-front-left`. Unknown markers are preserved verbatim, never dropped.
There is **no** `thumb` tag and no spritesheet/turnaround format in this
version.

A parsed definition exposes both shapes:

```ts
def.image; // string | undefined — the primary image URL
def.images; // GameItemImage[]    — every valid image tag, in tag order
```

`image` is the first unmarked image, falling back to the first image when every
image is marked, and `undefined` when there is no valid image tag. Image tags
with a missing or blank URL are ignored with an `invalid-image-tag` warning.

**Authoring guidance.** Official item definitions SHOULD publish **exactly one
unmarked `image` tag**. That image is the canonical/default one: clients SHOULD
use it for inventory, shop, list and card UI, and clients that do not
understand view markers will use it. Marked images are pose/view-specific
assets — they are not replacements for the primary image, and the fallback to
the first marked view applies **only** when no unmarked image exists.

This is guidance, not a requirement: an item with only marked images (or none
at all) is still valid and parses normally. The parser reports the two
authoring problems as non-fatal warnings, in both permissive and strict mode:

| Warning                   | When                                               |
| ------------------------- | -------------------------------------------------- |
| `missing-primary-image`   | valid image tags exist, but all of them are marked |
| `multiple-primary-images` | more than one unmarked image tag                   |

Neither warning rejects the event, changes `image`/`images`, or makes `image`
required (an item with no image tag at all is not warned about).

```ts
getPrimaryItemImage(item): string | undefined
getItemImageByMarker(item, marker): GameItemImage | undefined
getItemImagesByMarker(item, marker): GameItemImage[]
isGameItemImageMarker(value): value is GameItemImageMarker
```

The builder takes the primary image as `image` and the views as `images`:

```ts
buildGameItemDefinitionEvent({
  id: "blobbi:cosmetic:wizard_hat",
  name: "Wizard Hat",
  type: "cosmetic",
  image: "https://ex.com/hat.png",
  images: [
    { url: "https://ex.com/hat-front.png", marker: "front" },
    { url: "https://ex.com/hat-back.png", marker: "back" },
  ],
});
```

It emits the primary image first, then the marked views in order, skipping
blank URLs and duplicate identical image tags. An unmarked entry in `images`
also counts as the primary image; supplying two _different_ unmarked URLs
throws, since the primary image would be ambiguous.

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
    `wrong-referenced-kind`, `invalid-json-content`, `invalid-image-tag`,
    `missing-primary-image`, `multiple-primary-images`, `duplicate-item`).

Warnings also carry SHOULD-level authoring guidance (e.g. the primary-image
warnings above). They never affect the parsed value and never reject the event,
including in strict mode.

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
7. **Primary image when the `image` tag repeats.** The spec says an item
   "SHOULD" have exactly one unmarked `image` tag but does not require it.
   Parsing therefore picks the first unmarked image, falls back to the first
   image when all of them are marked, and treats a blank marker slot as no
   marker — and reports the deviation as a warning rather than an error, so
   authoring tools can flag it without any client rejecting the item.

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
      { types, images, address, validate, parse, build, index }
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
