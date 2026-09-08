# @nostr-games/inventory

TypeScript library for describing game items, inventories and item placements
as Nostr events, plus an append-only spend model so that more than one
application can debit the same inventory without overwriting it.

It covers five event kinds. The kinds are draft specifications written and
maintained in this repository (see [`docs/`](./docs)). They are not accepted
NIPs and not an official Nostr standard.

The package is the protocol layer only: constants, types, parsers, validators,
builders, relay-filter builders and pure state derivation. It never signs,
fetches, publishes, stores, or decides whom to trust. It has no runtime
dependencies and no import-time side effects, and any object shaped like a
Nostr event (for example one from `nostr-tools`) can be passed in.

## Event kinds

| Kind    | Type        | Question it answers                                  | Spec                                                                |
| ------- | ----------- | ---------------------------------------------------- | ------------------------------------------------------------------- |
| `31632` | addressable | What is this item?                                   | [Game Item Definition](./docs/31632-game-item-definition-v2.md)     |
| `31633` | addressable | Which items does this owner hold, and how many?      | [Game Inventory](./docs/31633-game-inventory.md)                    |
| `31634` | addressable | Where are items equipped or placed?                  | [Game Item Placement](./docs/31634-game-item-placement.md)          |
| `1416`  | regular     | The owner debits N of one item from one inventory.   | [Spend and Fold Manifest](./docs/1416-1417-game-inventory-spend.md) |
| `1417`  | regular     | Which spends has an inventory snapshot incorporated? | [Spend and Fold Manifest](./docs/1416-1417-game-inventory-spend.md) |

Addressable events are identified by `<kind>:<pubkey>:<d>`. The `d` value may
itself contain colons (for example `mygame:food:carrot`), so address parsing
splits only on the first two colons.

Each kind keeps its state in a different place:

- `31632` and `31633`: the tags are the state. `content` is optional metadata
  and may be an empty string.
- `31634`: `content` must be a JSON object and is the state. The `a` tags are a
  derived index so relays can answer `#a` queries.
- `1416` and `1417`: tags only. Both are immutable regular events identified by
  event id.

Wire shapes in short:

```text
31632  ["d", id] ["name", …] ["type", …]                          required
       ["image", url] ["image", url, "front"] ["t", topic] …      optional
31633  ["d", context]  ["a", "31632:<issuer>:<d>", relay, "<qty>"]*
       ["revision", "<n>"]  ["e", id, relay, "grant"]*  ["e", id, relay, "fold"]
31634  content = { version?, revision?, target?, reference?, placements[] }
       ["a", "<target>", relay, "target"] | ["target", id]   ["a", "<item>", relay, "item"]*
1416   ["a", "31633:<owner>:<d>", relay, "inventory"] ["a", "31632:<issuer>:<d>", relay, "item"] ["quantity", "<n>"]
1417   ["a", "31633:<owner>:<d>", relay, "inventory"] ["e", id, relay, "previous"]? ["e", id, relay, "spend" | "void"]+
```

The `d` tag of a `31633` event is an opaque inventory context chosen by the
application. One owner can have any number of them. The library defines no
default context.

## Installation

```bash
pnpm add @nostr-games/inventory
# or: npm i @nostr-games/inventory
```

ESM and CJS builds with type declarations. Node 18 or newer.

## Quick example

`kind:31633` is addressable, so publishing replaces the whole event. Anything
you do not carry over is gone for every other client too. The read-modify-write
path below keeps the tags this library does not manage, including ones it does
not understand.

```ts
import {
  parseGameInventoryResult,
  addInventoryItemQuantity,
  toBuildGameInventoryInput,
  buildGameInventoryEvent,
  buildGameItemAddress,
} from "@nostr-games/inventory";

// 1. Read the newest kind:31633 event for this owner and context.
const parsed = parseGameInventoryResult(newestEventFromRelay);
if (!parsed.ok) throw new Error(parsed.error);
const inventory = parsed.value; // parsed.warnings lists ignored tags

// 2. Change it. Helpers return a new object and never mutate the input.
const carrot = buildGameItemAddress("<issuer-pubkey>", "mygame:food:carrot");
const next = addInventoryItemQuantity(inventory, carrot, 3);

// 3. Rebuild the full replacement, preserving unmanaged tags and the fold
//    reference, and bump the advisory revision.
const unsigned = buildGameInventoryEvent({
  ...toBuildGameInventoryInput(next),
  revision: (next.revision ?? 0) + 1,
});
// unsigned = { kind: 31633, content, tags }. Add pubkey and created_at,
// sign and publish with your own tooling.
```

`toBuildGameInventoryInput` returns the typed fields plus `preserveTags`. The
builder strips the tags it manages (`d`, `revision`, `context`, `name`, `alt`,
every `a` tag, and `e` tags marked `grant` or `fold`), regenerates them, and
keeps every other tag in its original order. Only valid item references are
republished. Tags the parser rejected stay on `inventory.event.tags` for
inspection.

The same pattern exists for placements: `parseGameItemPlacementResult`,
`setEquippedPlacementForSlot`, `toBuildGameItemPlacementInput`,
`buildGameItemPlacementEvent`.

## Core behavior

These rules apply to every kind.

**Two parser shapes.** `parseX(event)` returns the value or `null`.
`parseXResult(event)` returns `{ ok: true, value, warnings }` or
`{ ok: false, error, warnings }`. Warnings carry a machine-readable code such
as `invalid-quantity`, `malformed-address` or `duplicate-item`.

**Permissive and strict modes.** Every parser takes `mode`. Structural problems
reject in both modes: wrong kind, missing or empty `d`, missing required
`31632` tags, a `31634` `content` that is not a JSON object, a spend or manifest
that breaks a structural rule. Permissive mode (the default) keeps the event and
reports recoverable problems as warnings: an invalid `31633` item tag is
skipped, a malformed `31633` `revision` is ignored, a malformed `31634`
placement entry is dropped, invalid JSON `content` is kept as a raw string.
Strict mode rejects those instead. Unknown tags, fields, markers and
enum-like values are never rejected in either mode.

**Duplicate inventory items.** `duplicateStrategy` is `last`, `sum` or
`strict`. Permissive parsing defaults to `last`; strict parsing defaults to
`strict`.

**Nothing is coerced.** Quantities are canonical positive integer strings
(`"3"`, not `"03"`, `"+3"` or `"3.0"`). Numeric strings never become numbers.
`NaN`, `Infinity` and unsafe integers are never accepted. Zero quantity means
"not held": the inventory builder omits the item, and a spend of zero throws.

**Throw versus result.** Caller bugs throw: an empty `id`, a malformed address,
a non-integer amount, an `extraTags` entry that collides with a builder-managed
tag. Data conditions return structured results, for example
`removeInventoryItemQuantityChecked` returns
`{ ok: false, reason: "insufficient-quantity", available, requested }` where
`removeInventoryItemQuantity` clamps at zero.

**Unknown data survives.** Parsed structures keep unknown fields through index
signatures, placement helpers copy entries with those fields intact, and a
placement keeps its raw `content` string and full `contentJson` (including
entries the parser rejected) for repair work.

**Builders are deterministic.** Tag order is fixed per kind and identical input
produces identical output. Builders return `{ kind, content, tags }` and never
create `id` or `sig`.

**Relay filters.** `buildGameInventoryFilter({ authors: [pubkey] })` lists every
inventory context an owner has, since relays index addressable events by author
and kind. Relays match `#a` by value, not by marker, so
`filterEventsByPlacementItemAddress` narrows placement results locally.

**Pubkeys.** Address parsing accepts any non-empty pubkey segment by default so
that fixtures and spec examples work. Pass `requireHexPubkey: true` (and, for
spends and manifests, `requireHexEventId: true`) to require 64-character
lowercase hex.

## Spends and folds

An addressable inventory has one current version. If a farm game and an island
game both replace `31633:<player>:farm`, the last write wins and the other is
lost. Kinds `1416` and `1417` let any application debit an inventory without
replacing it.

```text
snapshot  kind:31633  replaced as a whole; by convention one application writes it
spend     kind:1416   owner-signed debit of one item; only ever added
fold      kind:1417   lists which spend ids a snapshot incorporated; only ever added

effective balance = snapshot quantities
                    - applied spends not reachable through the snapshot's fold chain
```

**A spend** references exactly one inventory and exactly one item by full
address and carries one positive integer quantity. `event.pubkey` must equal the
owner pubkey inside the inventory address, or the event is not a spend and is
rejected at parse time. `purpose`, `client`, `nonce` and `alt` tags are kept but
never affect accounting. The event id is the spend's identity, so a retry
republishes the same signed event.

**Derivation** (`deriveGameInventoryState`) is a fixed procedure: deduplicate
by event id, drop structurally invalid events, ignore valid spends against other
inventories, set aside spends the fold chain has settled, sort the rest by
`(created_at asc, id asc)`, then walk them. A spend whose quantity is at most
the current balance is applied and decrements it. Anything else is rejected in
full: no partial application, no clamping. The result does not depend on the
order events arrived in. The effective inventory comes back as an ordinary
`GameInventory`, together with the status of every candidate: `applied`,
`rejected`, `folded`, `voided`, `ignored` or `invalid`.

**A fold manifest** lists applied spends as `spend` and rejected spends as
`void`, and may point at the previous manifest. A voided spend never applies
again, even against a later, larger balance. A manifest with no references, or
one that lists the same id twice, is rejected. The snapshot references its
manifest with `["e", "<manifest-id>", relay, "fold"]`.

**Chain resolution** (`resolveGameInventoryFoldChain`) walks from the
snapshot's fold reference through `previous` links, stops on a cycle, and
returns `unresolved` when a manifest is missing, invalid, scoped to another
inventory, or (when spend events are supplied) references a spend that is
invalid or belongs to another inventory.
`resolveGameInventoryState` combines resolution and derivation and produces no
balance at all when the chain is unresolved. It does not guess in either
direction. A snapshot with no fold reference resolves trivially and every valid
spend against it is pending.

**Settlement is by id, never by time.** `created_at` orders pending spends. It
never decides whether a spend is settled, because a relay can deliver an older
spend after a newer snapshot. `buildGameInventorySpendFilter` has no `since` for
the same reason.

**Publish the manifest first**, wait for a relay to accept it, then publish the
snapshot that references it. An orphan manifest settles nothing. A snapshot that
points at a manifest nobody can fetch is unresolved for every reader.

The owner's write cycle:

```ts
const r = resolveGameInventoryState({ inventory: base, folds, spends });
if (r.status !== "resolved") {
  // fetch the manifests named in r.chain.problems and retry
}
const next = addInventoryItemQuantity(r.state.inventory, harvested, 2);

const foldInput = toBuildGameInventoryFoldInput(r.state); // null if nothing to settle
const manifest = foldInput && buildGameInventoryFoldEvent(foldInput);
// sign and publish the manifest, wait for acceptance, note its id …

const unsigned = buildGameInventoryEvent({
  ...toBuildGameInventoryInput(next), // carries the previous fold reference
  ...(manifest ? { fold: { eventId: manifestId } } : {}),
  revision: (next.revision ?? 0) + 1,
});
```

Full rules, worked examples and the reasoning behind each decision are in
[`docs/1416-1417-game-inventory-spend.md`](./docs/1416-1417-game-inventory-spend.md).

## Trust and concurrency boundaries

Things the library checks:

- A spend or manifest is accepted only if `event.pubkey` equals the owner in
  the inventory address it references. This is a pubkey comparison. The library
  does not verify signatures; that is your relay client's or signer's job.
- Structural validity of every event, as described above.
- Revision ordering. `compareGameInventoryRevisions` and
  `compareGameItemPlacementRevisions` return `unknown`, `stale`, `equivalent`,
  `conflict` or `ahead`. Two states with the same revision are `equivalent`
  only on hard evidence: the same event id, or byte-identical tags (31633) or
  byte-identical `content` (31634). `created_at` is never used to break a tie,
  since timestamps are publisher-controlled.

Things the library does not do, and cannot do from the events alone:

- It does not decide whether an item issuer is trusted, whether an item is
  really in an inventory, whether an author may modify a placement target, or
  whether anything should render. Those are application policy.
- Revisions are advisory. They are not a lock and not compare-and-swap. Nostr
  has neither. Two instances of the owner that both rewrite from the same base
  still race; `revision` lets a later reader notice, nothing here prevents it.
- "One replacement writer per inventory context" is a coordination convention
  between honest applications. The protocol cannot stop a player, or a client
  holding the player's key, from replacing their own inventory or voiding their
  own spends.
- Absence of an event from a relay is not evidence it does not exist. A
  derived balance is correct for the events you supplied, not globally final.
- Equipping an item in a `31634` event does not change any `31633` quantity.
- Grants are not defined. `31633` can carry `e` tags marked `grant` and the
  library preserves them, but no grant kind or grant verification exists.

## Specifications

The protocol documents are the source of truth for wire format, validation
rules and design rationale. The inventory, placement and spend documents end
with a list of the decisions taken where an earlier draft was ambiguous.

- [`docs/31632-game-item-definition-v2.md`](./docs/31632-game-item-definition-v2.md)
- [`docs/31633-game-inventory.md`](./docs/31633-game-inventory.md)
- [`docs/31634-game-item-placement.md`](./docs/31634-game-item-placement.md)
- [`docs/1416-1417-game-inventory-spend.md`](./docs/1416-1417-game-inventory-spend.md)

All four are marked `draft` and are maintained here together with the
implementation. If a spec and the implementation disagree, please open an
issue.

## API overview

Every export is listed in [`src/index.ts`](./src/index.ts). The same families
exist for each kind.

| Purpose             | Names                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kind constants      | `KIND_GAME_ITEM_DEFINITION`, `KIND_GAME_INVENTORY`, `KIND_GAME_ITEM_PLACEMENT`, `KIND_GAME_INVENTORY_SPEND`, `KIND_GAME_INVENTORY_FOLD`                 |
| Addresses           | `buildGameItemAddress`, `buildGameInventoryAddress`, `buildGameItemPlacementAddress`, their `parse*` counterparts, `getDTag`                            |
| Parse and validate  | `parseGameX`, `parseGameXResult`, `validateGameX` for each of the five kinds                                                                            |
| Build               | `buildGameXEvent` for each kind; `toBuildGameInventoryInput`, `toBuildGameItemPlacementInput` for lossless rewrites                                     |
| Relay filters       | `buildGameXFilter` for each kind, `filterEventsByPlacementItemAddress`                                                                                  |
| Inventory quantity  | `getInventoryItemQuantity`, `setInventoryItemQuantity`, `addInventoryItemQuantity`, `removeInventoryItemQuantity`, `removeInventoryItemQuantityChecked` |
| Placement queries   | `getPlacementById`, `getPlacementsByItem`, `getPlacementsBySlot`, `getFirstEquippedPlacementBySlot`, `getLastEquippedPlacementBySlot`                   |
| Placement mutations | `addPlacement`, `replacePlacement`, `removePlacement`, `setEquippedPlacementForSlot`, `removeEquippedPlacementFromSlot`                                 |
| Item images         | `getPrimaryItemImage`, `getItemImageByMarker`, `getItemImagesByMarker`, `GAME_ITEM_IMAGE_MARKERS`                                                       |
| Revisions           | `compareGameInventoryRevisions`, `compareGameItemPlacementRevisions`                                                                                    |
| Spends and folds    | `deriveGameInventoryState`, `resolveGameInventoryFoldChain`, `resolveGameInventoryState`, `toBuildGameInventoryFoldInput`, `sortGameInventorySpends`    |
| Type guards         | `isAddressPlacementTarget`, `isInternalPlacementTarget`, `isGameItemPlacement2DReference`, `isGameItemPlacementMode`, …                                 |

Mutation helpers never modify their input and return a new top-level object.
Inventory helpers copy the item list. Placement helpers deep-copy placement
entries and recompute `itemAddresses`. Everything else is carried over by
reference, so `content`, `contentJson`, `itemTags`, `targetTags` and `event`
still describe the source event. Rebuild to regenerate them.

## Development and testing

Requires Node 18 or newer and pnpm (the version is pinned in `package.json`).

```bash
pnpm install
pnpm run typecheck    # tsc --noEmit
pnpm run lint         # eslint
pnpm run format:check # prettier
pnpm run test         # vitest run
pnpm run build        # tsup: ESM + CJS + d.ts into dist/
pnpm run check        # all of the above
```

Tests live in `test/` and run with vitest. Several of them are the numbered
worked examples from the spend specification. CI (`.github/workflows/ci.yml`)
runs the full `check` on pushes to `main` and on pull requests.

Layout:

```text
src/
  index.ts               public exports
  nostr/event.ts         NostrEvent and UnsignedEventTemplate
  common/                addresses, tags, JSON content, ParseResult, shared checks
  kinds/
    game-item-definition/   kind 31632
    game-inventory/         kind 31633
    game-item-placement/    kind 31634
    game-inventory-spend/   kind 1416
    game-inventory-fold/    kind 1417
docs/                    the protocol drafts
test/                    vitest suites
```

## Status and versioning

The package is pre-1.0. The event kinds are draft specifications and may still
change.

## Changelog and license

Release notes are in [CHANGELOG.md](./CHANGELOG.md). Licensed under the
[MIT License](./LICENSE).
