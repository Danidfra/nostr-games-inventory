# @nostr-games/inventory

Framework-independent TypeScript library implementing three Nostr event kinds
for games:

- **`kind:31632`** — Game Item Definition — _what an item is_
- **`kind:31633`** — Game Inventory — _which items are held, and how many_
- **`kind:31634`** — Game Item Placement — _where items are equipped or placed_

It provides constants, types, parsers, builders, validators and helpers for
these kinds. It is pure, has no import-time side effects, no framework or
application dependencies, and works in both browser and Node environments.

> Status: published to npm. This is the protocol layer only. No React, hooks,
> UI, relay clients, signers, encryption, grants, persistence, or publishing are
> included.

## Responsibility boundaries

The three kinds answer three different questions and must not be conflated:

```text
definition != ownership != placement
31632      != 31633    != 31634
```

A **placement** event does not define an item, does not prove ownership, does
not grant, spend or consume anything, does not claim a reward, does not
authorize itself, does not verify its own author, does not enforce inventory
ownership, and does not decide whether anything should render. Those are
application policy, or belong to future event kinds — see
[Authorization boundary](#authorization-boundary).

## Design principles

- **TypeScript-first**, strict compiler settings, no `any` casts.
- **Pure functions**, no global/module side effects.
- **Source of truth per kind.** For `31632` and `31633` the tags are
  authoritative and `content` is optional metadata. For `31634` the `content`
  document is authoritative and the `a` tags are a derived index — see
  [Content authority](#content-authority-31634).
- **Unknown data survives.** Unknown tags, unknown content fields and unknown
  enum-like values are preserved through parsing, mutation and rebuilding.
- **Nothing is coerced.** Numeric strings never become numbers; `NaN` and
  `Infinity` are never accepted where a real value is expected.
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
KIND_GAME_ITEM_PLACEMENT; // 31634
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

buildGameItemPlacementAddress(pubkey, placementId): string
parseGameItemPlacementAddress(address, options?): GameItemPlacementAddress | null

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
buildGameItemDefinitionFilter(options?): GameItemDefinitionFilter
```

`buildGameItemDefinitionFilter` resolves the definitions an inventory references
(`{ authors: [issuer], itemIds: [...] }` — one issuer at a time, since the two
fields intersect and two issuers may share a `d`), or discovers items by
category (`{ topics: ["edible"] }`, which works across issuers because `t` is
relay-indexable). Whether to trust any issuer remains application policy.

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
toBuildGameInventoryInput(inventory): BuildGameInventoryInput
buildGameInventoryFilter(options?): GameInventoryFilter

compareGameInventoryRevisions(current, incoming): GameInventoryRevisionStatus
parseInventoryRevision(raw): number | null
encodeInventoryRevision(value): string
INVENTORY_REVISION_TAG // "revision"
```

#### An inventory is a context, not "the" inventory

The `d` tag is an **opaque, application-defined inventory context**. A player may
own any number of `kind:31633` events with different `d` values, all valid at
once — a game inventory, a backpack, a chest, a character's bag, a vault. There
is no canonical or default inventory, and this package deliberately defines no
`d` constant.

Which contexts an application writes, reads, aggregates or allows gameplay with
is that application's policy, never a protocol rule.

#### Discovering every inventory an owner has

Addressable events are indexed by author and kind, so a client that knows only a
pubkey can enumerate all of them without knowing any `d` in advance:

```ts
buildGameInventoryFilter({ authors: [pubkey] });
// { kinds: [31633], authors: [pubkey] }  -> newest event for EVERY d
```

No index event is needed and none exists. Pass `inventoryIds` only when you
specifically want one known context — pinning a single `#d` on the read side
makes a client structurally unable to see any inventory but its own.

#### The safe rewrite path

`kind:31633` is addressable, so publishing REPLACES the whole event. Anything
the builder does not regenerate and you do not preserve is destroyed
permanently — for every other client too, not just yours. Rebuilding by hand
from a couple of fields compiles, looks correct, and silently deletes the
contexts, grants, content and unknown tags other applications wrote.

`toBuildGameInventoryInput` is the path that does not lose data:

```ts
const base = parseGameInventory(newestEvent);
const next = addInventoryItemQuantity(base, itemAddress, 1);

const unsigned = buildGameInventoryEvent({
  ...toBuildGameInventoryInput(next),
  revision: (next.revision ?? 0) + 1,
});
```

Structured data comes back through the typed fields; every tag the builder does
not manage comes back through `preserveTags`. Managed tags — `d`, `revision`,
`context`, `name`, `alt`, every `a` tag, and `e` tags marked `grant` — are
stripped from the preserved list and regenerated, so a rebuild never strands a
stale duplicate. Everything else survives in its original relative order.

Emitted tag order is fixed:

```text
d -> revision -> context* -> name -> a* -> e(grant)* -> alt
  -> preserved tags -> extraTags
```

Only _valid_ data round-trips. Item references the parser rejected are not
republished and duplicates have already been resolved, exactly as in the
kind:31634 round-trip; both remain on `inventory.event.tags` for repair work.

#### Revision semantics (31633)

```ts
compareGameInventoryRevisions(current, incoming):
  "unknown" | "stale" | "equivalent" | "conflict" | "ahead"
```

The counter lives in a `["revision", "<n>"]` **tag**, not in `content`. This is
the one place 31633 diverges from 31634's shape, and the kinds' own semantics
force it: a placement's `content` is its authoritative state document, while an
inventory's state is in its tags and its `content` is optional metadata that is
an empty string by default. Writing a counter there would mean inventing a JSON
object where publishers legitimately have none, and clobbering whatever a peer
stored. The comparison semantics are unchanged from 31634.

**What it gives you:** two states with valid, different revisions can be
ordered, and two states claiming the same revision are reported as `conflict`
unless there is hard evidence — the same event id, or byte-identical tags — that
they are the same state.

**What it does not give you:** it is not a lock and not compare-and-swap. Nostr
has neither. It does not prevent a concurrent write, does not replace
addressable-event resolution, cannot detect anything against a peer that omits
the tag, and does not define a merge. Resolving a `conflict` is your decision.

`created_at` is never consulted to break an equal-revision tie — timestamps are
publisher-controlled — and tags are never sorted or normalized before comparison.

A malformed `revision` is ignored with an `invalid-revision` warning in
permissive mode and rejects only in strict mode. Refusing to parse a player's
whole inventory because a peer wrote a bad advisory counter would make every
item they own vanish from every UI; an ignored revision degrades to `unknown`,
which is the designed safe fallback.

### Quantity helpers

```ts
parseInventoryQuantity(raw): number | null      // positive integer strings only
getInventoryItemQuantity(inventory, itemAddress): number
setInventoryItemQuantity(inventory, itemAddress, quantity, relay?): GameInventory
addInventoryItemQuantity(inventory, itemAddress, amount, relay?): GameInventory
removeInventoryItemQuantity(inventory, itemAddress, amount): GameInventory
removeInventoryItemQuantityChecked(inventory, itemAddress, amount): GameInventoryRemovalResult
```

All inventory helpers are **immutable**: they return a new `GameInventory` and
never mutate the input.

`removeInventoryItemQuantity` clamps its _result_ at zero, so removing 5 units of
an item the player holds 2 of succeeds silently. That is right for "take up to
N" and is unchanged. For a spend, where an over-spend must not look like a
success, use `removeInventoryItemQuantityChecked`, which returns
`{ ok: false, reason: "insufficient-quantity", available, requested }` instead.

The division is the one the package uses throughout: a caller bug (a malformed
address, a non-integer amount) throws; a data condition (not enough of the item)
is a structured result.

### Kind 31634 — Game Item Placement

```ts
parseGameItemPlacement(event, options?): GameItemPlacement | null
parseGameItemPlacementResult(event, options?): ParseResult<GameItemPlacement>
buildGameItemPlacementEvent(input): UnsignedEventTemplate<31634>
toBuildGameItemPlacementInput(placement): BuildGameItemPlacementInput
validateGameItemPlacement(event, options?): ItemPlacementValidationResult
```

#### Placement identity: `d` is not the target

A placement event is addressable as `31634:<author-pubkey>:<d-tag>`. The `d`
value identifies a **placement-state document**, which is a separate thing from
what the placement points at. Never assume `d` equals a character id, room id,
map id or target id — a publisher may embed one, but that is a local
convention.

```ts
buildGameItemPlacementAddress("pk", "blobbi-island:character:char-1:equipment");
// "31634:pk:blobbi-island:character:char-1:equipment"
```

Colons inside `d` round-trip correctly: parsing splits only on the first two.

#### Content authority (31634)

`content` MUST be a JSON object and is authoritative:

```jsonc
{
  "version": 1, // optional, non-negative integer
  "revision": 4, // optional, non-negative integer
  "target": {/* … */}, // optional, authoritative
  "reference": {/* … */}, // optional coordinate system
  "placements": [/* … */], // may be empty
}
```

This is a deliberate difference from 31632/31633, where `content` is optional
metadata. An empty `content` string, a JSON array, `null`, a string or a number
is rejected — there is no placement document to read.

The `a` tags are a **derived index** that exists so relays can answer `#a`
queries. An `a` tag with no matching entry in `content.placements` is not a
placement.

#### Target union

```ts
type GameItemPlacementTarget =
  | { type: "address"; address: string; relay?: string; [key: string]: unknown }
  | { type: "internal"; id: string; [key: string]: unknown }
  | { type: string; [key: string]: unknown }; // unknown, preserved verbatim

isAddressPlacementTarget(target): boolean
isInternalPlacementTarget(target): boolean
```

- An `address` target must carry a valid full `<kind>:<pubkey>:<d>` address.
  Which kinds are acceptable targets is your decision, not the library's.
- An `internal` target must carry a non-empty `id`.
- A target with an unknown `type` is **preserved, not rejected**; no canonical
  tag can be derived from it.
- A missing target is valid and only warns.

Canonical target tags, at most one per event:

```json
["a", "<addressable-target>", "<relay-url>", "target"]
["target", "<internal-target-id>"]
```

When `content.target` is present it wins; disagreeing tags produce a
`target-mismatch` warning and are still exposed as `placement.targetTags`
metadata. When it is absent, target tags are the only (unauthenticated) hint
and are left alone.

#### Item-derived tags and marker filtering

Every unique `placements[].item` address yields exactly one tag, in
first-placement order:

```json
["a", "31632:<issuer>:<item-d>", "<relay-url>", "item"]
```

**Relays filter `#a` by value, not by marker.** A `#a` query also returns events
that reference the same address as their target or through an unrelated `a`
relationship, so you must narrow locally:

```ts
const filter = buildGameItemPlacementFilter({ addresses: [hatAddress] });
// -> { kinds: [31634], "#a": [hatAddress] }
const mine = filterEventsByPlacementItemAddress(events, hatAddress);

isPlacementItemTag(tag): boolean
isPlacementTargetTag(tag): boolean
getPlacementItemTags(event | tags): GameItemPlacementItemTag[]
getPlacementTargetTags(event | tags): GameItemPlacementTargetTag[]
```

#### 2D and 3D references

```jsonc
{ "space": "2d", "unit": "percent",    "origin": "top-left", "width": 100, "height": 100 }
{ "space": "2d", "unit": "normalized", "origin": "center",   "width": 1,   "height": 1 }
{ "space": "3d", "unit": "meters",     "origin": "center", "handedness": "right-handed", "upAxis": "y" }
```

```ts
isGameItemPlacement2DReference(reference): boolean
isGameItemPlacement3DReference(reference): boolean
```

A recognized `2d` reference requires `unit`, `origin` and finite `width` /
`height`; a recognized `3d` reference requires `unit` and `origin`, and makes
`position.z` mandatory on every entry. Unknown `space` values — and unknown
units, origins, handedness and up axes — are preserved and never validated
away. **Coordinates are never normalized and no rendering defaults are written
into the parsed document.**

#### Transforms

All transform numbers must be finite; numeric strings are never coerced.

| Field      | Rule                                                                                                                                          |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `position` | `x`, `y` required; `z` required under a 3D reference. Never clamped.                                                                          |
| `rotation` | `euler` (`unit` required, `x`/`y`/`z` optional — z-only is valid for 2D) or `quaternion` (`x`,`y`,`z`,`w` required). Unknown types preserved. |
| `scale`    | `x`, `y` required, `z` optional. Zero and negative are allowed.                                                                               |
| `flip`     | `x`, `y` required booleans.                                                                                                                   |
| `layer`    | any finite number, not required to be an integer.                                                                                             |

A zero-length quaternion is rejected. Quaternions are never normalized, and unit
length is not required.

```ts
isGameItemPlacementEulerRotation(rotation): boolean
isGameItemPlacementQuaternionRotation(rotation): boolean
```

#### equip vs place

```ts
GAME_ITEM_PLACEMENT_MODES; // ["equip", "place"]
isGameItemPlacementMode(value): boolean
```

`equip` attaches an item to a `slot` on the target; `place` positions it inside
the target. Unknown modes stay valid and produce an `unknown-placement-mode`
warning, because `mode` decides how an entry is interpreted. Unknown slots are
valid and silent.

#### Query and mutation helpers

```ts
getPlacementItems(placement): string[]                 // unique item addresses
getPlacementById(placement, id): GameItemPlacementEntry | undefined
getPlacementsByItem(placement, itemAddress): GameItemPlacementEntry[]
getPlacementsBySlot(placement, slot): GameItemPlacementEntry[]   // ALL modes
getFirstEquippedPlacementBySlot(placement, slot): GameItemPlacementEntry | undefined
getLastEquippedPlacementBySlot(placement, slot): GameItemPlacementEntry | undefined

addPlacement(placement, entry): GameItemPlacement
replacePlacement(placement, entry): GameItemPlacement
removePlacement(placement, id): GameItemPlacement
setEquippedPlacementForSlot(placement, slot, entry): GameItemPlacement
removeEquippedPlacementFromSlot(placement, slot): GameItemPlacement
```

Slot reads are explicit by design: there is no ambiguous
`getEquippedPlacementBySlot`. `getPlacementsBySlot` returns **every** entry for
the slot regardless of mode; the `First`/`Last` helpers return only
`mode: "equip"` entries.

**Duplicate policy.** Duplicate entry ids and duplicate equipped slots never
invalidate a parsed document; they warn. Then:

| Helper                            | Behavior with duplicates                                                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `addPlacement`                    | throws if the id already exists                                                                                              |
| `replacePlacement`                | replaces the **first** match, leaves later ones alone                                                                        |
| `removePlacement`                 | removes **every** entry with that id                                                                                         |
| `setEquippedPlacementForSlot`     | deterministic **last-wins**: removes every conflicting `equip` entry for the slot, inserts one at the first removed position |
| `removeEquippedPlacementFromSlot` | removes every `equip` entry for the slot, keeps other modes                                                                  |

`setEquippedPlacementForSlot` takes a complete replacement entry — it generates
nothing on your behalf. `mode` must be `"equip"`, and `slot` must match or be
omitted.

All mutations are immutable at every depth (entries are deep-copied) and
preserve unrelated entries, unknown entry fields, and top-level
`target`/`reference`/`version`/`revision`/unknown content. They update
`placements` and the derived `itemAddresses`, and deliberately carry
`content`, `contentJson`, `itemTags`, `targetTags` and `event` through
unchanged: those describe the _source event_. Rebuild to regenerate them.

#### Unknown-data preservation and round-tripping

Preservation works on three levels:

1. **Index signatures** on every parsed structure (target, reference, entries,
   transforms), so unknown fields are typed as `unknown` rather than dropped.
2. **`placement.content`** (the raw string) and **`placement.contentJson`** (the
   full parsed object, _including_ entries the parser rejected) — the escape
   hatch for repair workflows.
3. **`toBuildGameItemPlacementInput(placement)`**, which feeds unknown top-level
   content fields back through `contentExtra` and the original tags through
   `preserveTags`.

```ts
const next = setEquippedPlacementForSlot(placement, "head", entry);
const unsigned = buildGameItemPlacementEvent({
  ...toBuildGameItemPlacementInput(next),
  revision: (next.revision ?? 0) + 1,
});
```

Only _valid_ entries round-trip; entries the parser rejected are not
republished, and remain on `contentJson` for inspection.

#### Builder managed tags

The builder owns `d`, `context`, `t`, `alt`, the canonical target relationship,
and the derived `a`+`item` tags. Emitted order:

```text
d → context* → t* → target → item* → alt → preserved tags → extraTags
```

- `preserveTags` (typically `placement.event.tags`) is carried over with **stale
  managed tags stripped**, so rebuilding never duplicates or strands them.
  Unrelated tags — including `a` tags with no marker or a different marker —
  survive in their original relative order.
- Target tags are stripped only when the input `target` is a _known_ type, since
  only then can a canonical replacement be derived. With no target, or an
  unknown target type, preserved target tags are kept as-is.
- `extraTags` **throws** on a conflict with a managed tag, matching the other
  builders in this package.
- Identical input produces byte-identical output. This is ordinary
  `JSON.stringify` over a deterministically constructed object — no
  canonical-JSON dependency is introduced.

#### Revision semantics

```ts
compareGameItemPlacementRevisions(current, incoming):
  "unknown" | "stale" | "equivalent" | "conflict" | "ahead"
```

`revision` is **advisory** and does not replace Nostr addressable-event
resolution. Two states sharing a revision are only `equivalent` on hard
evidence: the same event id, or byte-identical original `content`.

`created_at` is deliberately never consulted — wall-clock timestamps are
publisher-controlled, so using them to break a tie would silently pick a winner
where the honest answer is `conflict`. JSON is never re-canonicalized to
manufacture a match. Resolving a conflict is your decision.

#### Authorization boundary

The library exposes target and item relationships. It never decides whether:

- the author owns or may modify the target;
- the author is delegated;
- the item is in any inventory;
- the issuer is trusted;
- the item is valid for the slot;
- the placement should render.

Equipping does **not** consume inventory quantity, and unequipping does **not**
change it. Possession is `kind:31633`'s concern. A typical application policy
gates on author permission, inventory quantity > 0, trusted issuer, and
slot/form compatibility before rendering — all of it outside this package.

## Parsing behavior: modes and results

Every parser accepts a `mode`:

- **`permissive`** (default) — follows the specs' "SHOULD tolerate" rules.
  Unknown tags are kept, invalid item tags are ignored, invalid JSON `content`
  does not block tag parsing, duplicate inventory items resolve using the
  recommended default (`last` valid quantity).
- **`strict`** — rejects the event where the specs allow rejection: invalid
  JSON `content`, duplicate item references (see below), and — for `31634` — any
  malformed placement entry or malformed reference.

"MUST reject" conditions reject the event in **both** modes: wrong kind,
missing/empty `d`, missing required `31632` tags, and for `31634` a `content`
that is not a JSON object, a non-array `placements`, a malformed known `target`,
or an invalid `version`/`revision`.

For `31634` specifically:

- a malformed **entry** is dropped with an `invalid-placement-entry` warning in
  permissive mode and rejects the event in strict mode; the original entry stays
  available on `contentJson`;
- **tag/content mismatches are warnings in both modes** — the tags are a derived
  index, so the right response is to republish repaired tags, not to discard
  state;
- unknown fields and unknown enum-like values are never rejected in either mode,
  simply because this version does not know them.

Parsers come in two flavors so failures are never silently hidden:

- `parseX(...) => X | null` — convenience.
- `parseXResult(...) => ParseResult<X>` — structured result exposing:
  - `ok: false` + `error` for a **rejected event**;
  - `ok: true` + `value` for a valid event, plus `warnings[]` describing
    **valid events with invalid tags that were ignored** and other recoverable
    issues (e.g. `invalid-quantity`, `malformed-address`,
    `wrong-referenced-kind`, `invalid-json-content`, `invalid-image-tag`,
    `missing-primary-image`, `multiple-primary-images`, `duplicate-item`).

Placement warnings are: `invalid-placement-entry`, `duplicate-placement-id`,
`duplicate-equip-slot`, `unknown-placement-mode`, `invalid-reference`,
`missing-reference`, `missing-target`, `target-mismatch`,
`duplicate-target-tag`, `missing-item-tag`, `orphaned-item-tag`,
`duplicate-item-tag`. Every one has a clear consumer action, and a canonical
document produces none: `missing-reference` fires only when an entry actually
carries a `position`, and unknown reference spaces and rotation types are
preserved silently.

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

- validate input before generating anything (throw on empty `id`/`name`/`type`,
  invalid item addresses, malformed transforms, or invalid quantities — nothing
  is floored, clamped or silently dropped);
- produce unsigned templates (`{ kind, content, tags }`), never `id`/`sig`;
- **omit zero-quantity items** (31633), since `0` means "not held";
- emit tags in a **stable, deterministic order**, so identical input produces
  identical output;
- never duplicate the tags they manage; `extraTags` are appended verbatim and
  **throw** on a conflict with a managed tag;
- never sign, never publish, never fetch.

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

### Equipping an item (kind 31634)

Generic, not tied to any particular game:

```ts
import {
  buildGameItemAddress,
  buildGameItemPlacementEvent,
  parseGameItemPlacementResult,
  setEquippedPlacementForSlot,
  toBuildGameItemPlacementInput,
  getLastEquippedPlacementBySlot,
} from "@nostr-games/inventory";

const hat = buildGameItemAddress("<issuer>", "cosmetic:wizard_hat");

// 1. Publish an initial equipment document for a character.
const first = buildGameItemPlacementEvent({
  id: "mygame:character:char-1:equipment",
  revision: 1,
  target: { type: "address", address: "31124:<owner>:char-1" },
  placements: [{ id: "head", item: hat, mode: "equip", slot: "head" }],
  contexts: ["game:mygame"],
  alt: "Character equipment",
});
// -> { kind: 31634, content: "{...}", tags: [["d", …], ["context", …],
//      ["a", "31124:<owner>:char-1", "", "target"], ["a", hat, "", "item"],
//      ["alt", …]] }
// Sign and publish `first` with your own signer/relay client.

// 2. Later: read the newest event back and swap what is in the slot.
const parsed = parseGameItemPlacementResult(latestEventFromRelay);
if (!parsed.ok) throw new Error(parsed.error);
const placement = parsed.value;
console.log(parsed.warnings); // e.g. stale item tags to repair

const scarf = buildGameItemAddress("<issuer>", "cosmetic:scarf");
const next = setEquippedPlacementForSlot(placement, "head", {
  id: "head",
  item: scarf,
  mode: "equip",
  slot: "head",
});

getLastEquippedPlacementBySlot(next, "head")?.item; // scarf

// 3. Rebuild the complete replacement state, preserving unknown data.
const updatedEvent = buildGameItemPlacementEvent({
  ...toBuildGameItemPlacementInput(next),
  revision: (next.revision ?? 0) + 1,
});
```

Note what the library did **not** do: it did not check that the author may
modify `char-1`, that the scarf is in any inventory, or that `head` is a legal
slot for it — and equipping changed no inventory quantity. Those gates are your
application's.

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

### kind:31633 decisions (this release)

8. **`revision` is a tag, not a content field.** kind:31634 carries its counter
   in `content` because content is its authoritative state. An inventory's state
   is its tags and its `content` is optional metadata that is an empty string by
   default, so a counter there would mean inventing a JSON object publishers do
   not have and clobbering whatever a peer stored. The comparison semantics are
   unchanged from 31634.
9. **A malformed `revision` warns rather than rejects.** kind:31634 rejects an
   invalid counter. For an inventory that would make every item a player owns
   vanish from every client because a peer wrote a bad advisory value, so
   permissive mode ignores it with an `invalid-revision` warning and degrades to
   `unknown`; strict mode still rejects.
10. **Equal-revision evidence is the tags, not the content.** 31634 compares the
    raw `content` string because that is its state. 31633 compares the tag list
    element-by-element, exactly as received, for the same reason. Nothing is
    sorted or normalized, so a differing tag order is honestly a `conflict`.
11. **The `created_at` tie-break follows NIP-01.** The spec previously said
    clients "MAY choose either one"; it now says lowest event id, matching
    NIP-01, because leaving it open invited two clients to disagree about the
    current inventory in the one case where agreement matters most.

### kind:31634 decisions

12. **`content` is required and authoritative.** Unlike the other two kinds, a
    placement carries its state in `content`, so an empty/non-object `content` is
    rejected instead of tolerated. There is deliberately no `requireJsonContent`
    option for 31634.
13. **Unknown discriminators are preserved, not rejected.** A malformed _known_
    target rejects the event, but an unknown `target.type`, an unknown
    `reference.space` and an unknown `rotation.type` are kept verbatim. Rejecting
    them would make this version reject documents written against a newer one.
14. **Absent vs. wrong `placements`.** An absent `placements` is read as an empty
    list with a warning; a present non-array `placements` rejects the event. Both
    spellings of "nothing is placed" are understood, but a structurally wrong
    value is never guessed at.
15. **`version` and `revision` reject when invalid.** They are advisory, but a
    present-and-invalid counter (including a numeric _string_) is a content
    error, not something to silently coerce or ignore.
16. **Tag/content mismatch is a warning, never a rejection** — in strict mode
    too. The tags are a derived index; the fix is to republish repaired tags.
17. **`z` is required only under a recognized 3D reference.** Otherwise
    `position.z` is optional, so the same entry shape serves 2D and 3D.
18. **Slot reads are explicit.** No `getEquippedPlacementBySlot`; the caller asks
    for first, last, or all. Slot _writes_ are deterministic last-wins.
19. **Mutations do not refresh source-event fields.** `content`, `contentJson`,
    `itemTags`, `targetTags` and `event` still describe the event the placement
    was parsed from; rebuilding regenerates everything from `placements`.

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
    strings.ts                   # isBlank, uniqueNonBlank
    numbers.ts                   # finite / non-negative-integer checks (internal)
    objects.ts                   # isPlainObject, deep JSON clone (internal)
  kinds/
    game-item-definition/        # kind 31632
      { types, images, address, filter, validate, parse, build, index }
    game-inventory/              # kind 31633
      { types, address, quantity, revision, filter, validate, parse, build,
        helpers, index }
    game-item-placement/         # kind 31634
      { types, guards, address, tags, content, validate, parse, build,
        helpers, revision, index }
test/                            # vitest suites
docs/                            # the three protocol drafts
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
