# Changelog

All notable changes to `@nostr-games/inventory` are documented here.

This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
While the major version is `0`, minor bumps may add public API but aim to stay
backward compatible.

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
