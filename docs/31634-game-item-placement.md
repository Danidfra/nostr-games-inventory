# NIP-XX

## Game Item Placement

`draft` `optional`

This NIP defines `kind:31634`, an addressable event that declares **where** referenced game items are currently equipped or placed.

> **Editorial note.** This document was written alongside the `@nostr-games/inventory` implementation of kind:31634. Where the earlier working draft was ambiguous, the resolution is recorded inline under "Rationale" or "Decision" so the choice is visible rather than hidden in code.

## Purpose

A `kind:31634` event answers exactly one question:

```text
Where are these items currently equipped or placed, on this target?
```

It does **not**:

- define an item — that is `kind:31632`;
- prove possession — that is `kind:31633`;
- grant an item;
- spend or consume an item;
- claim a reward;
- authorize itself;
- verify the placement author;
- enforce inventory ownership;
- decide whether a placement should render.

Those decisions are application policy, or belong to future event kinds.

```text
definition != ownership != placement
31632      != 31633    != 31634
```

## Event kind

`31634` is an addressable event.

The placement address is:

```text
31634:<author-pubkey>:<d-tag>
```

## Placement identity

The `d` tag identifies a **placement-state document**. It is separate from the target.

```json
["d", "<placement-id>"]
```

The value MUST be non-empty and SHOULD be stable.

Clients MUST NOT assume `d` equals a character id, room id, map id or target id. A publisher MAY choose a `d` that embeds the target id, but that is a local convention, not part of this specification.

Recommended format:

```text
<namespace>:<scope>:<selector>:<aspect>
```

Examples:

```json
["d", "blobbi-island:character:char-1:equipment"]
["d", "myworld:room:home:decor"]
["d", "avatar:default:outfit"]
```

Like every addressable `d` in this family of kinds, the value MAY contain `:`. A full address such as `31634:pubkey123:blobbi-island:character:char-1:equipment` therefore has more than three colon-separated segments; parsers MUST split only on the first two colons.

Clients SHOULD treat the latest event for the same `31634:<author-pubkey>:<d-tag>` as the current placement state.

## Event format

```json
{
  "kind": 31634,
  "content": "{...}",
  "tags": [
    ["d", "<placement-id>"],
    ["context", "<context>"],
    ["t", "<topic>"],
    ["a", "<addressable-target>", "<relay-url>", "target"],
    ["target", "<internal-target-id>"],
    ["a", "31632:<issuer-pubkey>:<item-d-tag>", "<relay-url>", "item"],
    ["alt", "Game item placement: <description>"]
  ]
}
```

A placement event carries a target relationship in **either** the `a`+`target` form **or** the `target` form, never both.

## Content is authoritative

Unlike `kind:31632` and `kind:31633`, where tags are the source of truth and `content` is optional metadata, a placement event carries its state **in `content`**.

`content` MUST be a JSON object.

```json
{
  "version": 1,
  "revision": 4,
  "target": { "type": "address", "address": "31124:<pubkey>:char-1" },
  "reference": {
    "space": "2d",
    "unit": "percent",
    "origin": "top-left",
    "width": 100,
    "height": 100
  },
  "placements": [
    {
      "id": "head",
      "item": "31632:<issuer>:blobbi:cosmetic:wizard_hat",
      "mode": "equip",
      "slot": "head"
    }
  ]
}
```

**Decision.** An empty `content` string, a JSON array, `null`, a string or a number MUST be rejected as a placement event. There is no placement document to read, so tolerating it would leave clients guessing. This differs deliberately from `kind:31632`/`kind:31633`, where an empty `content` is normal.

The `a` tags are a **derived index**. They exist so relays can answer `#a` queries. They are never the state: an `a` tag with no matching entry in `content.placements` is not a placement.

### `version`

Optional advisory schema version. When present it MUST be a non-negative integer (a JSON number, never a string).

### `revision`

Optional advisory state counter. When present it MUST be a non-negative integer.

`revision` does **not** replace Nostr addressable-event resolution. It is a hint that lets an application notice a lost update or a fork. See [Revision semantics](#revision-semantics).

### `target`

Optional. When present it is **authoritative**: builders derive the canonical target tag from it, and a target tag that disagrees is a stale index, not a competing claim.

```ts
type GameItemPlacementTarget =
  | { type: "address"; address: string; relay?: string; [key: string]: unknown }
  | { type: "internal"; id: string; [key: string]: unknown };
```

- An `address` target MUST carry a valid full addressable-event address `<kind>:<pubkey>:<d>`. This spec does not restrict which kinds may be targets.
- An `internal` target MUST carry a non-empty `id`. Use it for targets that have no addressable event of their own, such as a local room id.
- Unknown fields MUST be preserved.
- A target whose `type` this version does not define MUST NOT be rejected. It is preserved verbatim, and no canonical target tag can be derived from it.

A placement with **no** target is valid. Clients MAY warn, because consumers cannot tell what such a placement applies to.

Canonical target tags:

```json
["a", "<addressable-target>", "<relay-url>", "target"]
["target", "<internal-target-id>"]
```

When `content.target` is absent, existing target tags MAY still be exposed as metadata — but they are unauthenticated hints only.

### `reference`

Optional coordinate system for the entries' transforms.

```json
{ "space": "2d", "unit": "percent", "origin": "top-left", "width": 100, "height": 100 }
{ "space": "2d", "unit": "normalized", "origin": "center", "width": 1, "height": 1 }
{ "space": "3d", "unit": "meters", "origin": "center", "handedness": "right-handed", "upAxis": "y" }
```

- A recognized `2d` reference MUST carry `unit`, `origin`, and finite `width` and `height`.
- A recognized `3d` reference MUST carry `unit` and `origin`. `handedness` and `upAxis` are optional.
- When a `3d` reference is declared, every entry `position` MUST carry a `z` component.
- Unknown `space` values MUST be preserved, and their contents MUST NOT be validated or destroyed.
- Unknown `unit`, `origin`, `handedness` and `upAxis` values MUST be preserved.
- Coordinates MUST NOT be normalized, and defaults MUST NOT be written into the parsed document. Rendering defaults belong to consumers.

A missing `reference` is valid. Clients SHOULD warn only when an entry actually carries a `position`, since equipment-only documents legitimately have no coordinate system.

### `placements`

The placement entries.

```json
{
  "id": "head",
  "item": "31632:<issuer-pubkey>:blobbi:cosmetic:wizard_hat",
  "mode": "equip",
  "slot": "head",
  "position": { "x": 50, "y": 20 },
  "rotation": { "type": "euler", "unit": "degrees", "z": 15 },
  "scale": { "x": 1, "y": 1 },
  "flip": { "x": false, "y": false },
  "layer": 3,
  "form": "baby",
  "view": "front",
  "metadata": {}
}
```

Required on every entry:

| Field  | Rule                                         |
| ------ | -------------------------------------------- |
| `id`   | non-empty string, stable inside the document |
| `item` | a valid full `kind:31632` address            |
| `mode` | non-empty string                             |

Recommended `mode` values:

```text
equip   the item is attached to a slot on the target
place   the item is positioned inside the target
```

Unknown modes remain valid; clients MAY warn, because `mode` decides whether an entry is equipment or a placed object.

Optional fields:

- `slot` — non-empty string when present. Unknown slots are valid; slot compatibility is never enforced here.
- `position`, `rotation`, `scale`, `flip`, `layer` — see [Transforms](#transforms).
- `form`, `view` — non-empty strings when present. `view` values usually match the `kind:31632` image view markers.
- `metadata` — arbitrary JSON, never interpreted.
- Unknown entry fields MUST be preserved.

`placements` MAY be empty: an empty list is how a publisher says "nothing is currently placed".

**Decision.** A `placements` field that is present but not an array MUST reject the event. An **absent** `placements` field SHOULD be read as an empty list, with a warning. The two spellings of "nothing is placed" are both understood; a structurally wrong value is not guessed at.

## Transforms

Every number in a transform MUST be a real, finite JSON number. Numeric **strings** MUST NOT be coerced, and `NaN`, `Infinity` and `-Infinity` MUST NOT be accepted.

### Position

```json
{ "x": 50, "y": 20 }
{ "x": 1.5, "y": 0.2, "z": -3 }
```

`x` and `y` are required. `z` is required when a `3d` reference is declared and optional otherwise. Coordinates MUST NOT be clamped.

### Rotation — Euler

```json
{ "type": "euler", "unit": "degrees", "order": "xyz", "x": 0, "y": 0, "z": 90 }
```

`unit` is required and MUST be non-empty. `order` is optional. Every component is optional, so a 2D placement carrying `z` alone is valid. Provided components MUST be finite. Future `unit` and `order` values MUST survive parsing.

### Rotation — quaternion

```json
{ "type": "quaternion", "x": 0, "y": 0.7071, "z": 0, "w": 0.7071 }
```

All four components are required and MUST be finite. A zero-length quaternion (all components `0`) MUST be rejected. Quaternions MUST NOT be normalized automatically, and unit length is NOT required by this version.

A rotation whose `type` this version does not define MUST be preserved verbatim rather than rejected.

### Scale

```json
{ "x": 1, "y": 1 }
{ "x": 2, "y": 2, "z": 2 }
```

`x` and `y` are required; `z` is optional. All provided values MUST be finite. Zero and negative values are valid — they are legitimate ways to hide or mirror an item.

### Flip

```json
{ "x": true, "y": false }
```

Both components are required and MUST be booleans.

### Layer

```json
{ "layer": 3 }
```

A finite number. It is NOT required to be an integer.

## Item references

Every unique `placements[].item` address SHOULD produce exactly one item tag:

```json
["a", "31632:<issuer-pubkey>:<item-d-tag>", "<relay-url>", "item"]
```

Rules:

- `content` remains authoritative;
- deduplicate by full item address;
- preserve first-placement order when deriving the tags;
- never emit duplicate item tags;
- use `""` when no relay hint is known.

Clients SHOULD warn about, but never reject for:

- a placed item with no derived `item` tag (the event is not discoverable by `#a`);
- an `item` tag with no matching placement ("orphaned"): it is **not** a placement;
- duplicate `item` tags.

### Marker filtering

Standard relays filter `#a` by **value**, not by marker:

```json
{ "kinds": [31634], "#a": ["31632:<issuer>:blobbi:cosmetic:wizard_hat"] }
```

This query also matches events that reference the same address as their target, or through any unrelated `a` relationship. Clients MUST narrow the results locally by checking the marker, or by parsing `content.placements`.

An `a` tag with no marker, or with a marker other than `item`/`target`, MUST NOT be interpreted as an item placement.

## Recommended tags

### `context`

Repeatable. Describes the game or world the placement belongs to. Used for local filtering, UI grouping and metadata discovery; relays are not expected to index it.

### `t`

Repeatable topic tag, indexable by relays.

### `alt`

Human-readable fallback for clients that do not understand `kind:31634`. RECOMMENDED, never auto-generated.

## Update rules

Because `kind:31634` is addressable, the latest event for a given `31634:<pubkey>:<d>` is the current placement state.

When publishing an update, clients SHOULD publish the **complete** current placement state for that document. Clients SHOULD NOT publish partial placement diffs.

## Revision semantics

`revision` is advisory. Comparing an incoming document against the current one yields:

| Result       | Condition                                                                        |
| ------------ | -------------------------------------------------------------------------------- |
| `unknown`    | one or both revisions are missing or invalid                                     |
| `stale`      | incoming revision is lower                                                       |
| `equivalent` | equal revisions, and the event ids match or the original `content` strings match |
| `conflict`   | equal revisions, and neither the event id nor the `content` matches              |
| `ahead`      | incoming revision is higher                                                      |

Implementations MUST NOT:

- use `created_at` to resolve an equal-revision conflict — wall-clock timestamps are publisher-controlled;
- merge states automatically;
- canonicalize JSON to turn two different source documents into an `equivalent` result.

Resolving a `conflict` is an application decision.

## Duplicate entries

A valid document SHOULD NOT contain duplicate entry `id` values, and SHOULD NOT equip more than one entry to the same slot.

Neither invalidates the document. Parsers SHOULD warn, and libraries MUST make the resolution explicit rather than picking silently — for example by exposing "first equipped in slot", "last equipped in slot" and "all entries in slot" separately.

For canonical slot mutation, **last-wins** is the recommended deterministic semantics: replacing a slot removes every conflicting `equip` entry for it and leaves exactly one.

## Trust and authorization model

A `kind:31634` event is a **self-declared** placement state by its author.

By itself it does not prove that:

- the author owns or may modify the target;
- the author possesses the placed items;
- the items came from a trusted issuer;
- the item is valid for the slot it claims.

Applications decide all of the above. A typical policy is:

1. the placement author must be allowed to modify the target;
2. the item must be present in the relevant `kind:31633` inventory with quantity greater than zero;
3. the item definition must come from a trusted issuer;
4. slot and form compatibility must match the application's rules;
5. unknown or untrusted placements are not rendered in production.

Equipping an item MUST NOT consume inventory quantity, and unequipping MUST NOT change it. Possession is `kind:31633`'s concern.

Real-time movement is explicitly out of scope: `kind:31634` is a state document, not a movement channel.

## Validation rules

A client or library MUST reject a `kind:31634` event if:

```text
kind is not 31634
d tag is missing, empty or whitespace-only
content is not valid JSON
content JSON is not an object (including an empty content string)
content.placements is present and is not an array
content.target is present and its known shape is malformed
content.version or content.revision is present and is not a non-negative integer
```

A client or library operating permissively SHOULD:

```text
omit a malformed placement entry and warn, keeping the rest of the document
omit a malformed reference and warn
preserve the original content so repair and round-trip workflows lose nothing
tolerate unknown modes, slots and structurally safe future fields
surface tag/content mismatches as warnings
never treat an orphaned item tag as a placement
```

A client or library operating strictly SHOULD additionally reject the event when any placement entry is malformed, or the reference is malformed.

Unknown fields and unknown enum-like values MUST NOT be rejected merely because an implementation does not know them, in either mode. Tag/content mismatches are warnings in both modes: the tags are a derived index, so the correct response is to republish repaired tags, not to discard state.

A client or library MUST tolerate:

```text
unknown tags
unknown target types
unknown reference spaces, units, origins, handedness and up axes
unknown rotation types and rotation orders
unknown modes and unknown slots
unknown top-level content fields
unknown entry fields
missing target
missing reference
empty placements
d values containing colons
```

## Examples

### Character equipment, addressable target

```json
{
  "kind": 31634,
  "content": "{\"version\":1,\"revision\":4,\"target\":{\"type\":\"address\",\"address\":\"31124:ownerpubkey:char-1\"},\"placements\":[{\"id\":\"head\",\"item\":\"31632:issuerpubkey:blobbi:cosmetic:wizard_hat\",\"mode\":\"equip\",\"slot\":\"head\"}]}",
  "tags": [
    ["d", "blobbi-island:character:char-1:equipment"],
    ["context", "game:blobbi-island"],
    ["a", "31124:ownerpubkey:char-1", "", "target"],
    ["a", "31632:issuerpubkey:blobbi:cosmetic:wizard_hat", "", "item"],
    ["alt", "Game item placement: character equipment"]
  ]
}
```

### 2D room decoration, internal target

```json
{
  "kind": 31634,
  "content": "{\"revision\":2,\"target\":{\"type\":\"internal\",\"id\":\"room:home\"},\"reference\":{\"space\":\"2d\",\"unit\":\"percent\",\"origin\":\"top-left\",\"width\":100,\"height\":100},\"placements\":[{\"id\":\"rug\",\"item\":\"31632:issuerpubkey:home:decor:rug\",\"mode\":\"place\",\"position\":{\"x\":40,\"y\":72},\"rotation\":{\"type\":\"euler\",\"unit\":\"degrees\",\"z\":15},\"scale\":{\"x\":1.2,\"y\":1.2},\"layer\":1}]}",
  "tags": [
    ["d", "myworld:room:home:decor"],
    ["target", "room:home"],
    ["a", "31632:issuerpubkey:home:decor:rug", "", "item"],
    ["alt", "Game item placement: home decorations"]
  ]
}
```

### 3D world placement

```json
{
  "kind": 31634,
  "content": "{\"target\":{\"type\":\"internal\",\"id\":\"world:main\"},\"reference\":{\"space\":\"3d\",\"unit\":\"meters\",\"origin\":\"center\",\"handedness\":\"right-handed\",\"upAxis\":\"y\"},\"placements\":[{\"id\":\"statue\",\"item\":\"31632:issuerpubkey:world:prop:statue\",\"mode\":\"place\",\"position\":{\"x\":12,\"y\":0,\"z\":-4},\"rotation\":{\"type\":\"quaternion\",\"x\":0,\"y\":0.7071,\"z\":0,\"w\":0.7071},\"scale\":{\"x\":1,\"y\":1,\"z\":1}}]}",
  "tags": [
    ["d", "myworld:world:main:props"],
    ["target", "world:main"],
    ["a", "31632:issuerpubkey:world:prop:statue", "", "item"]
  ]
}
```

### Empty placement state

```json
{
  "kind": 31634,
  "content": "{\"revision\":7,\"target\":{\"type\":\"internal\",\"id\":\"room:home\"},\"placements\":[]}",
  "tags": [
    ["d", "myworld:room:home:decor"],
    ["target", "room:home"]
  ]
}
```

## Tag summary

| Tag       | Required | Repeated | Description                                                       |
| --------- | -------- | -------- | ----------------------------------------------------------------- |
| `d`       | yes      | no       | Placement document id                                             |
| `a`       | no       | yes      | Item reference with marker `item`, or target with marker `target` |
| `target`  | no       | no       | Internal target id                                                |
| `context` | no       | yes      | Game or world context                                             |
| `t`       | no       | yes      | Topic                                                             |
| `alt`     | no       | no       | Human-readable fallback                                           |

## Final decisions for kind 31634

```text
Kind: 31634
Name: Game Item Placement
Type: addressable
Author: placement publisher
Identity: 31634:<author-pubkey>:<d>
Required tags: d
Item tags: ["a", "31632:<issuer-pubkey>:<item-d-tag>", "<relay-url>", "item"]
Target tags: ["a", "<address>", "<relay-url>", "target"] or ["target", "<internal-id>"]
Recommended tags: context, t, alt
Content: REQUIRED JSON object; authoritative
Purpose: declare where referenced items are equipped or placed
Not purpose: item definition, ownership, grants, spending, rewards, authorization, movement
```
