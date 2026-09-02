# Changelog

All notable changes to `@nostr-games/inventory` are documented here.

This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
While the major version is `0`, minor bumps may add public API but aim to stay
backward compatible.

## Unreleased

Strengthens **kind:31633 Game Inventory** so that a writer can replace an
inventory without destroying data it does not own, and so that a reader can
detect a lost update. Both capabilities already existed for kind:31634; this
brings the kind that actually holds a player's property up to the same level.

Fully additive: every 0.3.0 API behaves exactly as before, no existing type
changed, and no existing behaviour was altered.

### Added

- **Lossless round-trip for kind:31633** — `toBuildGameInventoryInput(inventory)`
  turns a parsed inventory back into builder input, and `preserveTags` on
  `buildGameInventoryEvent` carries unrelated tags through a rewrite. Stale
  managed tags (`d`, `revision`, `context`, `name`, `alt`, every `a` tag, and
  `e` tags marked `grant`) are stripped and regenerated, so a rebuild never
  strands a duplicate; everything else survives in its original relative order.
  This is the kind:31634 `toBuildGameItemPlacementInput` / `preserveTags`
  pattern, applied to inventories.
- **Advisory revision for kind:31633** — an optional `["revision", "<n>"]` tag,
  exposed as `GameInventory.revision`, emitted from `BuildGameInventoryInput.revision`,
  and preserved by the round-trip. Helpers: `compareGameInventoryRevisions`
  (`unknown | stale | equivalent | conflict | ahead`), `parseInventoryRevision`,
  `encodeInventoryRevision`, `INVENTORY_REVISION_TAG`, plus the
  `GameInventoryRevisionStatus` and `GameInventoryRevisionCandidate` types.
  `created_at` is never used to break an equal-revision tie and tags are never
  normalized before comparison.
- **`removeInventoryItemQuantityChecked`** — a removal that reports
  `{ ok: false, reason: "insufficient-quantity", available, requested }` instead
  of clamping at zero, for spend paths where an over-spend must not look like a
  success. The clamping `removeInventoryItemQuantity` is unchanged.
- **Filter builders** — `buildGameInventoryFilter` and
  `buildGameItemDefinitionFilter`, matching the existing
  `buildGameItemPlacementFilter`. Passing only `authors` to the inventory filter
  enumerates every inventory context an owner has, with no `d` known in advance.
- **`invalid-revision`** parse warning code on `ParseWarningCode`.

### Changed

- `buildGameInventoryEvent` now rejects a `revision` tag supplied through
  `extraTags`, the same way it already rejects every other builder-managed tag.
  Previously `revision` had no meaning for this kind, so nothing could have been
  relying on it passing through.
- Internal only: `uniqueNonBlank` moved from `game-item-placement/tags.ts` to
  `common/strings.ts` so the three filter builders share one implementation. No
  public behaviour changed.

### Documentation

- `docs/31633-game-inventory.md` — `d` documented as an opaque,
  application-defined inventory context with many valid per owner and no
  canonical value; owner-wide discovery by author documented; a preservation
  requirement for writers; the optional revision tag with an explicit list of
  what it does and does not guarantee; and the `created_at` tie-break aligned
  with NIP-01's lowest-id rule, superseding the previous "MAY choose either".
- README — the safe rewrite path, revision semantics, discovery, and four new
  recorded design decisions for kind:31633.

## 0.3.0

Adds **kind:31634 Game Item Placement**. Backward compatible: every 31632,
image and 31633 API behaves exactly as before, and no existing type changed.

### Added

- **kind:31634 Game Item Placement** — where referenced items are currently
  equipped or placed. `KIND_GAME_ITEM_PLACEMENT`, `buildGameItemPlacementAddress`,
  `parseGameItemPlacementAddress`.
- **Parsing**: `parseGameItemPlacement`, `parseGameItemPlacementResult`,
  `validateGameItemPlacement`. `content` MUST be a JSON object and is
  authoritative; the `a` tags are a derived index.
- **Builder**: `buildGameItemPlacementEvent` plus
  `toBuildGameItemPlacementInput` for lossless round-tripping. Derives one
  `["a", …, "item"]` tag per unique item address in first-placement order, at
  most one canonical target tag, strips stale managed tags from `preserveTags`,
  and produces byte-identical output for identical input.
- **Target union**: `GameItemPlacementTarget` — `address`, `internal`, or an
  unknown type preserved verbatim — with `isAddressPlacementTarget` /
  `isInternalPlacementTarget`.
- **References and transforms**: 2D/3D `GameItemPlacementReference`,
  `GameItemPlacementPosition`, Euler and quaternion rotations,
  `GameItemPlacementScale`, `GameItemPlacementFlip`, and guards
  `isGameItemPlacement2DReference`, `isGameItemPlacement3DReference`,
  `isGameItemPlacementEulerRotation`, `isGameItemPlacementQuaternionRotation`.
  Every transform number must be finite; nothing is normalized or clamped.
- **Modes**: `GAME_ITEM_PLACEMENT_MODES` (`equip`, `place`) and
  `isGameItemPlacementMode`. Unknown modes stay valid.
- **Query helpers**: `getPlacementItems`, `getPlacementById`,
  `getPlacementsByItem`, `getPlacementsBySlot`,
  `getFirstEquippedPlacementBySlot`, `getLastEquippedPlacementBySlot`.
- **Immutable mutation helpers**: `addPlacement`, `replacePlacement`,
  `removePlacement`, `setEquippedPlacementForSlot` (deterministic last-wins),
  `removeEquippedPlacementFromSlot`.
- **Tag / query helpers**: `isPlacementItemTag`, `isPlacementTargetTag`,
  `getPlacementItemTags`, `getPlacementTargetTags`,
  `buildGameItemPlacementFilter`, `filterEventsByPlacementItemAddress`. Relays
  cannot filter `#a` by marker, so local narrowing is documented and provided.
- **Revision helper**: `compareGameItemPlacementRevisions` →
  `unknown | stale | equivalent | conflict | ahead`. `created_at` is never used
  to break an equal-revision tie and JSON is never re-canonicalized.
- **12 new parse warning codes** on `ParseWarningCode`:
  `invalid-placement-entry`, `duplicate-placement-id`, `duplicate-equip-slot`,
  `unknown-placement-mode`, `invalid-reference`, `missing-reference`,
  `missing-target`, `target-mismatch`, `duplicate-target-tag`,
  `missing-item-tag`, `orphaned-item-tag`, `duplicate-item-tag`.
- **`docs/31634-game-item-placement.md`** — the protocol draft, written
  alongside this implementation.

### Changed

- `docs/31633-game-inventory.md`: the `context` tag is now documented as being
  for **local** filtering, UI grouping and metadata discovery, since relays are
  not expected to index a non-single-letter `context` tag. Documentation only —
  the event model is unchanged.
- README documents all three kinds, the responsibility boundaries, the
  authorization boundary, and the 31634 design decisions.
- README no longer claims builders "normalize quantities (floor, clamp)"; they
  validate and throw, which is what the code has always done.

### Boundaries (unchanged by this release)

The package still never signs, publishes, fetches, or decides authorization. A
placement does not define an item, prove ownership, grant, spend, consume,
authorize itself, or decide whether anything renders. Equipping consumes no
inventory quantity.

## 0.2.0

Adds repeatable `image` tag support to **kind:31632 Game Item Definition**.
Backward compatible: existing single-image items, and every 31633 API, behave
exactly as before.

### Added

- **Repeatable `image` tags.** An `image` tag with no marker is the primary
  (default) image; an `image` tag with a third element carries a **view
  marker**:

  ```json
  ["image", "https://ex.com/hat.png"]
  ["image", "https://ex.com/hat-front.png", "front"]
  ```

- **`GameItemDefinition.images: GameItemImage[]`** — every valid `image` tag in
  tag order, including the primary image and the marked views. The existing
  `image?: string` field is unchanged in type and still holds the primary image
  URL.
- **View markers** defined by this version, exported as
  `GAME_ITEM_IMAGE_MARKERS`: `front`, `side-right`, `side-left`, `back`,
  `diagonal-front-right`, `diagonal-front-left`. Unknown markers are preserved
  verbatim as strings and never dropped.
- **Image helpers**, all pure and dependency-free:
  - `getPrimaryItemImage(item)` → `string | undefined`
  - `getItemImageByMarker(item, marker)` → `GameItemImage | undefined`
  - `getItemImagesByMarker(item, marker)` → `GameItemImage[]`
  - `isGameItemImageMarker(value)` — narrows to the known marker union
  - `selectPrimaryGameItemImage(images)` — the shared primary-image rule
- **Types**: `GameItemImage`, `GameItemImageMarker`, `GameItemImageMarkerValue`,
  `GameItemImageSource`.
- **Builder input `images?: GameItemImage[]`** — emits the primary image first,
  then the marked views in order, skipping blank URLs and duplicate identical
  image tags. An unmarked entry counts as the primary image; two _different_
  unmarked URLs throw, since the primary image would be ambiguous.
- **Non-fatal parse warnings** (`ParseResult.warnings`), never fatal in either
  permissive or strict mode:
  - `invalid-image-tag` — an `image` tag with a missing or blank URL, ignored;
  - `missing-primary-image` — the item has valid image tags but all of them are
    marked;
  - `multiple-primary-images` — the item has more than one unmarked image tag.

  Official item definitions SHOULD publish exactly one unmarked `image` tag,
  but an item that does not is still valid and still parses.

### Changed

- `GameItemDefinition.image` now resolves to the first **unmarked** `image` tag,
  falling back to the first valid image tag when every image is marked, and to
  `undefined` when there is no valid image tag. Previously it was the first
  `image` tag's raw value.
- An `["image", ""]` tag no longer yields `image: ""`; it is ignored with an
  `invalid-image-tag` warning. `image` is still optional and never required.
- The 31632 spec document and README document the primary/marked image model,
  the view markers and the authoring guidance.

### Not included in this version

- No `thumb` or `icon` tag — derive thumbnails from the primary image.
- No spritesheet or turnaround format.
- No animation, placement, grant or equipment schema.

Unknown tags and unknown markers are tolerated, so any of these can be added
later without breaking clients built against this release.

### Unchanged

- **kind:31633 Game Inventory** — parser, builder, validator, quantity helpers
  and duplicate-item strategies are untouched.

## 0.1.0

Initial release: kind:31632 Game Item Definition and kind:31633 Game Inventory
constants, types, parsers, builders, validators, address helpers and inventory
quantity helpers.
