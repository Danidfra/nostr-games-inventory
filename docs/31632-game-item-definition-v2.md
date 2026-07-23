# NIP-XX

## Game Item Definition

`draft` `optional`

This NIP defines `kind:31632`, an addressable event used to describe game items that can be referenced by inventories, grants, placements, markets, crafting systems, shops and other game-related events.

The purpose of this event is to define what an item is. It does not define who owns the item, who received the item, where the item is equipped, where it is placed, or whether the item is verified.

Ownership, grants, placements and spending are expected to be defined by separate event kinds.

## Kind

`31632`: Game Item Definition

This is an addressable event. The identity of an item definition is the tuple:

```
31632:<pubkey>:<d-tag>
```

The `pubkey` is the item issuer. The `d` tag is the item identifier chosen by that issuer.

Two item definitions with the same `d` tag and different authors are different items.

## Rationale

Games often need reusable item definitions such as food, weapons, materials, cosmetics, currencies, quest items, decorations and tools.

A game item definition should be addressable because the issuer may need to update metadata while keeping the same item identity. Examples include fixing an image URL, adding translations, adding topics, correcting a typo, or adding context-specific metadata.

Events that represent historical actions, such as granting an item to a user or consuming an item, should use regular events instead.

## Event format

```json
{
  "kind": 31632,
  "content": "{...}",
  "tags": [
    ["d", "<item-id>"],
    ["name", "<display-name>"],
    ["type", "<item-type>"],
    ["category", "<category>"],
    ["image", "<url>"],
    ["model_3d", "<url>"],
    ["audio", "<url>"],
    ["context", "<context>"],
    ["t", "<topic>"],
    ["a", "31632:<pubkey>:<d-tag>", "<relay-url>", "based_on"],
    ["alt", "Game item definition: <display-name>"]
  ]
}
```

## Required tags

### `d`

The `d` tag contains the stable item identifier.

```
["d", "<item-id>"]
```

The value MUST be non-empty. It SHOULD be stable and SHOULD NOT be changed for the same item.

Recommended format:

```
<namespace>:<category>:<slug>
```

Examples:

```
blobbi:food:carrot
blobbi:cosmetic:wizard_hat
farm:seed:tomato
spacegame:material:iron_ore
```

### `name`

The `name` tag contains the human-readable display name.

```
["name", "<display-name>"]
```

The value MUST be non-empty. Clients SHOULD use it as the default item label.

### `type`

The `type` tag contains the high-level item type.

```
["type", "<item-type>"]
```

The value MUST be non-empty. It SHOULD be a lowercase string.

Recommended values:

```
consumable
cosmetic
material
currency
quest
container
tool
weapon
armor
misc
```

Clients MAY accept other values.

## Recommended tags

### `category`

The `category` tag contains a more specific grouping inside the item type.

```
["category", "<category>"]
```

Examples:

```
food
headwear
ore
seed
potion
ammo
```

`type` is intended to be broad and cross-game. `category` is intended to be more specific.

### `image`

The `image` tag contains the primary image URL for the item.

```
["image", "<url>"]
```

Clients SHOULD use this image as the default icon or visual preview for the item.

### `context`

The `context` tag describes a context where the item was designed to be used.

```
["context", "<context>"]
```

This tag MAY be repeated.

Examples:

```
game:blobbi
game:blobbi-island
cross-game
collection:nostr-games
mod:example-mod
```

The `context` tag is only a hint. It does not prevent other games from using the item.

### `t`

The `t` tag contains reusable item topics.

```
["t", "<topic>"]
```

This tag MAY be repeated.

The `t` tag is used instead of a custom `trait` tag so relays and clients can filter items using standard tag filters.

Examples:

```
edible
vegetable
organic
equipable
wearable
headwear
crafting-material
flammable
ammo
```

Games MAY use topics to interpret items in a generic way. For example, a pet game may accept items with the `edible` topic as food, while a crafting game may accept items with the `wood` topic as material.

### `alt`

The `alt` tag contains a human-readable fallback for clients that do not understand this kind.

```
["alt", "Game item definition: <display-name>"]
```

This tag is RECOMMENDED but not required.

## Optional tags

### `symbol`

The `symbol` tag contains a short symbol or ticker.

```
["symbol", "CARROT"]
```

This is useful for currencies, materials or token-like items.

### `rarity`

The `rarity` tag contains a display rarity hint.

```
["rarity", "common"]
```

Recommended values:

```
common
uncommon
rare
epic
legendary
mythic
unique
```

Clients SHOULD treat rarity as display metadata only.

### `max_stack`

The `max_stack` tag contains the suggested maximum stack size.

```
["max_stack", "99"]
```

The value SHOULD be a positive integer encoded as a string. Games MAY ignore it.

### `model_3d`

The `model_3d` tag contains a URL for a 3D model.

```
["model_3d", "https://example.com/items/wizard_hat.glb"]
```

Clients MAY use this for 3D games, previews, placement systems or AR/VR clients.

### `audio`

The `audio` tag contains a URL for a sound effect or audio preview.

```
["audio", "https://example.com/sounds/equip.wav"]
```

Clients MAY use this when the item is equipped, previewed, consumed or interacted with.

### `version`

The `version` tag contains a schema or metadata version hint.

```
["version", "1"]
```

This is not the same as the addressable event version. The latest event for a given `31632:<pubkey>:<d>` remains the current item definition.

### `a` with marker `based_on`

The `a` tag MAY be used to reference another addressable item definition that this item derives from.

```
["a", "31632:<pubkey>:<d-tag>", "<relay-url>", "based_on"]
```

If no relay URL is known, clients MAY use an empty string as the third element when including the `based_on` marker:

```
["a", "31632:<pubkey>:<d-tag>", "", "based_on"]
```

This tag MAY be repeated.

Use cases include converted items, modded items, localized variants and cross-game reinterpretations.

Clients SHOULD treat an `a` tag with marker `based_on` as a derivation reference, not as proof of ownership or endorsement.

## Content

The `content` field SHOULD be a JSON object. It MAY be an empty string or an empty JSON object.

Tags contain indexable and reusable metadata. Content contains richer metadata that clients MAY use when they understand it.

Values that are already present as top-level tags SHOULD NOT be repeated inside `content` unless a game has a specific compatibility reason.

Recommended shape:

```json
{
  "description": "A short description of the item.",
  "effects": {},
  "metadata": {},
  "visual": {}
}
```

### `description`

A longer human-readable description.

```json
{
  "description": "A crunchy carrot. Blobbis love it."
}
```

### `effects`

Context-specific suggested effects.

```json
{
  "effects": {
    "game:blobbi": {
      "hunger": 10
    }
  }
}
```

Effects are metadata. The final behavior of an item is decided by the game or client using it.

### `metadata`

Additional machine-readable metadata that is not useful as a top-level indexable tag.

```json
{
  "metadata": {
    "stackable": true,
    "craftingGroup": "vegetables"
  }
}
```

Top-level tag values such as `rarity`, `max_stack`, `image`, `model_3d` and `audio` SHOULD NOT be duplicated here.

### `visual`

Extra visual or rendering metadata.

```json
{
  "visual": {
    "slot": "headwear",
    "forms": ["baby", "adult"],
    "sprite": "https://example.com/items/wizard-hat.svg"
  }
}
```

This object is optional and game-specific.

## Trust model

A `kind:31632` event defines an item. It does not prove that any user owns the item.

Trust is based on the item issuer, which is the event author.

A game MAY choose to accept:

- only its own issuer pubkeys
- a list of partner issuer pubkeys
- community-approved issuers
- any issuer
- self-declared or unverified items

Clients SHOULD consider the full item address, not only the `d` tag, when comparing items.

## Game rule model

Item definitions describe items. Games decide behavior.

For example, one game may use a carrot as food, another game may use it as a crafting material and another game may use a derived item as ammo.

If a game wants to reinterpret an item with a substantially different meaning, it SHOULD publish a new `kind:31632` item definition and reference the original with an `a` tag marked `based_on`.

## Update rules

Because `kind:31632` is addressable, the latest event for a given `31632:<pubkey>:<d>` is the current item definition.

Safe updates include:

- fixing image URLs
- fixing spelling
- adding translations
- adding topics
- adding contexts
- adding media tags
- adding metadata

Dangerous updates include:

- changing the item into an unrelated item
- changing `type` in a way that breaks existing inventories
- changing economic meaning after the item has been granted or traded
- changing a cosmetic into a currency or vice versa

If the meaning changes drastically, issuers SHOULD publish a new item definition with a new `d` tag and MAY reference the previous item using an `a` tag marked `based_on`.

## Validation

Clients SHOULD reject a `kind:31632` event as an item definition if:

- `kind` is not `31632`
- the `d` tag is missing or empty
- the `name` tag is missing or empty
- the `type` tag is missing or empty
- `content` is not valid JSON and the client requires strict JSON content

Clients SHOULD tolerate:

- unknown tags
- multiple `context` tags
- multiple `t` tags
- multiple `a` tags
- missing optional tags
- empty content
- content fields they do not understand

## Examples

### Blobbi Carrot

```json
{
  "kind": 31632,
  "content": "{\"description\":\"A crunchy carrot. Blobbis love it.\",\"effects\":{\"game:blobbi\":{\"hunger\":10}},\"metadata\":{\"stackable\":true}}",
  "tags": [
    ["d", "blobbi:food:carrot"],
    ["name", "Carrot"],
    ["type", "consumable"],
    ["category", "food"],
    ["image", "https://example.com/items/carrot.png"],
    ["context", "game:blobbi"],
    ["t", "edible"],
    ["t", "vegetable"],
    ["t", "organic"],
    ["rarity", "common"],
    ["max_stack", "99"],
    ["alt", "Game item definition: Carrot"]
  ]
}
```

### Wizard Hat

```json
{
  "kind": 31632,
  "content": "{\"description\":\"A magical-looking hat for your Blobbi.\",\"metadata\":{\"stackable\":false},\"visual\":{\"slot\":\"headwear\",\"forms\":[\"baby\",\"adult\"]}}",
  "tags": [
    ["d", "blobbi:cosmetic:wizard_hat"],
    ["name", "Wizard Hat"],
    ["type", "cosmetic"],
    ["category", "headwear"],
    ["image", "https://example.com/items/wizard-hat.png"],
    ["model_3d", "https://example.com/items/wizard_hat.glb"],
    ["audio", "https://example.com/sounds/equip.wav"],
    ["context", "game:blobbi"],
    ["t", "equipable"],
    ["t", "wearable"],
    ["t", "headwear"],
    ["rarity", "rare"],
    ["max_stack", "1"],
    ["alt", "Game item definition: Wizard Hat"]
  ]
}
```

### Carrot Round based on another item

```json
{
  "kind": 31632,
  "content": "{\"description\":\"Compressed carrot rounds used as organic ammo.\",\"effects\":{\"game:carrot-arena\":{\"ammo\":10}},\"metadata\":{\"stackable\":true}}",
  "tags": [
    ["d", "carrot-arena:ammo:carrot_round"],
    ["name", "Carrot Round"],
    ["type", "material"],
    ["category", "ammo"],
    ["image", "https://example.com/items/carrot-round.png"],
    ["context", "game:carrot-arena"],
    ["t", "ammo"],
    ["t", "organic"],
    ["a", "31632:<farm-issuer-pubkey>:farm:food:carrot", "", "based_on"],
    ["rarity", "common"],
    ["max_stack", "999"],
    ["alt", "Game item definition: Carrot Round"]
  ]
}
```
