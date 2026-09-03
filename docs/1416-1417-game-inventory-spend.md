# NIP-XX

## Game Inventory Spend and Fold Manifest

`draft` `optional`

This NIP defines two regular (immutable, append-only) event kinds that extend `kind:31633` Game Inventory with a safe cross-application spend model:

- `kind:1416` **Game Inventory Spend** — an owner-signed debit of one item quantity from one inventory;
- `kind:1417` **Game Inventory Fold Manifest** — an owner-signed record of exactly which spends a `kind:31633` snapshot has incorporated.

`kind:31633` remains the replaceable inventory snapshot. Nothing here modifies, replaces, or redefines it; a `kind:31633` event is only extended with one optional tag, specified in [`docs/31633-game-inventory.md`](./31633-game-inventory.md#optional-fold-reference) and summarised in [Changes to kind:31633](#changes-to-kind31633) below.

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as described in RFC 2119.

## Problem

An addressable event has exactly one current version per `(kind, pubkey, d)`. If two applications both replace `31633:<player>:farm:main` — the farm game to record a harvest and a second game to consume one strawberry — whichever publish lands last silently destroys the other. An advisory revision lets a later reader notice this; it cannot prevent it, and it cannot be relied on across applications that do not share a lock.

The model in this document keeps **one replacement writer per inventory context** as an application convention, and gives every other application an append-only way to debit the inventory:

```text
a consuming application publishes a player-signed kind:1416 spend;
readers derive
    effective balance = snapshot quantities − applicable spends not yet incorporated;
when the owning application next replaces the snapshot for its own reasons, it
    folds the outstanding spends into the new quantities and publishes a
    kind:1417 manifest listing exactly which spend ids it incorporated;
the new snapshot references that manifest.
```

Spends and manifests are immutable and identified by event id, so nothing is ever lost to a concurrent replace, and every reader given the same events derives the same balance.

## Terminology

| Term                  | Meaning                                                                                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **snapshot**          | The current `kind:31633` event for one inventory address.                                                                                                         |
| **inventory owner**   | The `<owner-pubkey>` in `31633:<owner-pubkey>:<d>`. Always equal to the snapshot's author.                                                                        |
| **valid spend**       | A `kind:1416` event that satisfies every structural rule in [Validation rules for kind:1416](#validation-rules-for-kind1416), including author = inventory owner. |
| **settled spend**     | A valid spend whose id is reachable through the snapshot's fold chain, as either a `spend` (folded) or a `void`.                                                  |
| **folded spend**      | A settled spend listed as `spend`: its debit is already inside the snapshot's quantities.                                                                         |
| **voided spend**      | A settled spend listed as `void`: the owner has recorded it as permanently not applicable. It never debits anything.                                              |
| **pending spend**     | A valid spend against this inventory address that is not settled.                                                                                                 |
| **applied spend**     | A pending spend that debits its quantity under the deterministic derivation.                                                                                      |
| **rejected spend**    | A pending spend whose quantity exceeds the available balance at its position in the deterministic order. Nothing is debited.                                      |
| **fold chain**        | The manifest the snapshot references, plus every manifest reachable from it through `previous` links.                                                             |
| **effective balance** | Snapshot quantity of an item minus the quantities of the applied spends of that item.                                                                             |

Structural validity and economic applicability are different questions. A valid spend may be rejected; an invalid event is never anything but ignored.

---

## kind:1416 — Game Inventory Spend

### Purpose

A `kind:1416` event answers:

```text
The owner of inventory 31633:<owner>:<d> has authorised removing <quantity>
units of item 31632:<issuer>:<item-d> from it.
```

It is a **debit only**. It does not add, transfer, reserve, convert, craft, or grant anything. Those are out of scope for this version and MUST NOT be expressed with `kind:1416`.

### Event kind

`1416` is a regular event. It is immutable: it is never replaced and never updated. Its event id is the durable identity of the spend, and every reference to a spend is by event id.

### Author

The event author MUST be the inventory owner:

```text
event.pubkey == <owner-pubkey> of the referenced 31633:<owner-pubkey>:<d>
```

An event whose author is any other pubkey is not a valid spend for that inventory and MUST NOT affect its balance, regardless of any `client` tag, relay, or application that published it.

This proves **player** authority. It does not prove **application** identity: nothing in this NIP lets a reader know cryptographically that "the farm game" or "the island game" created a spend. See [Security model](#security-model).

### Required tags

Exactly one inventory reference, exactly one item reference, and exactly one quantity:

```json
["a", "31633:<owner-pubkey>:<inventory-d-tag>", "<relay-url>", "inventory"]
["a", "31632:<issuer-pubkey>:<item-d-tag>", "<relay-url>", "item"]
["quantity", "<positive-integer>"]
```

- The inventory reference MUST be the full `31633:<owner-pubkey>:<d>` address, marked `inventory`. An inventory MUST NOT be identified by `d` alone.
- The item reference MUST be the full `31632:<issuer-pubkey>:<d>` address, marked `item`. An item MUST NOT be identified by `d` alone: two issuers using the same `d` are two different items.
- `quantity` MUST be a canonical positive decimal integer string, using the same encoding as the `kind:31633` quantity slot: no `0`, no sign, no decimals, no leading zeros, no whitespace, no exponent.
- The relay slot SHOULD be an empty string when unknown.

An `a` tag with no marker, or with any marker other than `inventory` or `item`, is an unrelated relationship and MUST be ignored.

### One item per event

A spend debits exactly one item. There are no multi-line spends.

This is deliberate. One event id is then one spend identity; applicability is a single comparison; ordering is total; partial application cannot arise; and a manifest reference settles exactly one debit. An application that consumes several items publishes several spends and MUST NOT expect them to be atomic — Nostr offers no multi-event transaction, and this NIP does not simulate one.

### Optional tags

```json
["purpose", "<free-form string>"]
["client", "<client-name>", "<31990:pubkey:d>", "<relay-url>"]
["nonce", "<opaque unique value>"]
["alt", "<human-readable fallback>"]
```

- `purpose` describes what the debit was for. Free-form.
- `client` follows the NIP-89 client tag shape; only the name (index 1) is defined here.
- `nonce` is an opaque uniqueness value, see below.
- `alt` is a human-readable fallback for clients that do not understand `kind:1416`.

**None of these affect accounting.** Whether a spend is valid, and whether it applies, is decided solely by the signer, the inventory address, the item address, the quantity, the event's `(created_at, id)` position, and the available balance. A parser MUST NOT reject a spend because of the content of an optional tag, and MUST NOT treat any of them as an authorisation.

Any other tag MUST be tolerated and preserved.

#### Why `nonce` exists

The event id is a hash over `pubkey`, `created_at`, `kind`, `tags` and `content`. Two spend events that are identical in all of those have the same id and therefore **are the same spend** — a relay will store one, and every reader will count one. A player who legitimately consumes one strawberry twice within the same second, through a client that emits identical tags, would otherwise have the second debit collapse into the first. A client that can emit two otherwise identical spends within one second SHOULD set a distinct `nonce` on each. A client that cannot has no need for it.

### Content

`content` SHOULD be an empty string. It MAY contain JSON metadata for display; it MUST NOT be required to interpret the spend and MUST NOT affect accounting.

### Retry and idempotency

Because a spend is immutable and identified by its id, a retry after an ambiguous publish MUST first attempt to find the already-signed event by id (a `{"ids": [...]}` query, or the client's own outbox). If it is found on any relay, the spend is published; republishing the exact same signed event to further relays is always safe. A client MUST NOT automatically sign a new equivalent spend on retry: a second signature is a second debit.

### Example

```json
{
  "kind": 1416,
  "pubkey": "<player>",
  "created_at": 1720000000,
  "content": "",
  "tags": [
    ["a", "31633:<player>:farm:main", "wss://relay.example", "inventory"],
    ["a", "31632:<farm-issuer>:farm:crop:strawberry", "", "item"],
    ["quantity", "1"],
    ["purpose", "feed:blobbi"],
    ["client", "blobbi-island"],
    ["alt", "Spent 1 strawberry from the farm inventory"]
  ]
}
```

### Invalid examples

Author is not the inventory owner — MUST be rejected, and MUST NOT debit `31633:<player>:farm:main` even though it names it:

```json
{
  "kind": 1416,
  "pubkey": "<attacker>",
  "tags": [
    ["a", "31633:<player>:farm:main", "", "inventory"],
    ["a", "31632:<farm-issuer>:farm:crop:strawberry", "", "item"],
    ["quantity", "1"],
    ["client", "farm"]
  ]
}
```

Inventory identified by `d` only — MUST be rejected (malformed address):

```json
["a", "farm:main", "", "inventory"]
```

Inventory reference to the wrong kind — MUST be rejected:

```json
["a", "31634:<player>:farm:main", "", "inventory"]
```

Item reference to the wrong kind — MUST be rejected:

```json
["a", "31633:<farm-issuer>:farm:crop:strawberry", "", "item"]
```

Invalid quantities — each MUST be rejected:

```json
["quantity", "0"]
["quantity", "-1"]
["quantity", "1.5"]
["quantity", "01"]
["quantity", "abc"]
```

Two inventory references, two item references, or two `quantity` tags — MUST be rejected. A parser MUST NOT pick one.

### Validation rules for kind:1416

A client or library MUST reject a `kind:1416` event as a spend if any of the following holds:

```text
kind is not 1416
the event has no id
there is not exactly one a tag marked inventory
the inventory address is malformed or does not reference kind 31633
event.pubkey is not the inventory address's owner pubkey
there is not exactly one a tag marked item
the item address is malformed or does not reference kind 31632
there is not exactly one quantity tag
quantity is not a canonical positive integer string
```

A client or library MUST tolerate:

```text
unknown tags
a tags with no marker or with other markers (ignored)
missing or blank optional metadata tags (ignored, MAY warn)
empty content
JSON content it does not understand
invalid JSON content when operating in permissive mode
```

A rejected event is not a spend. It is never applied, never folded, never voided, and never counted.

---

## Deterministic derivation

This section is normative for every reader and every writer.

### Spend order

Pending spends are totally ordered by:

```text
(created_at ascending, event id ascending)
```

Event ids are compared as plain strings; for canonical lowercase-hex ids this is the numeric order of the hash. It is the tie-break NIP-01 already uses for replaceable events, applied to the question "which of two concurrent spends gets the last unit".

Nothing else participates: not the order of receipt, not the relay, not the client, not `purpose`, not the reader's clock.

### Algorithm

Given a snapshot `S`, its resolved fold chain (yielding the sets `folded` and `voided`), and a set of candidate `kind:1416` events `C`:

```text
1. deduplicate C by event id;
2. discard every event that is not a valid spend (see validation rules);
3. discard every valid spend whose inventory address is not S's address;
4. set aside every remaining spend whose id is in folded or voided;
5. sort the remaining pending spends by (created_at, id);
6. for each item, balance := S's quantity of that item (0 if absent);
7. walk the pending spends in order:
     if spend.quantity <= balance[spend.item]:
         balance[spend.item] -= spend.quantity        -> applied
     else:
         leave balance unchanged                       -> rejected
8. effective quantity of each item := balance[item].
```

An implementation MUST NOT:

- apply part of a rejected spend;
- clamp a rejected spend to the available balance;
- defer a rejected spend in the hope that a later event makes it applicable;
- let the order in which events were received influence the result;
- consult `created_at` to decide whether a spend is settled (see [No timestamp watermark](#no-timestamp-watermark)).

Every implementation given the same `(S, fold chain, C)` MUST derive the same applied and rejected sets and the same effective quantities.

### Effective balance

```text
effective balance = snapshot quantities − applied pending spends
```

where "pending" means "not reachable through the snapshot's fold chain". This is the essential invariant of the whole model. A spend the snapshot has incorporated is never subtracted again; a spend the snapshot has not incorporated is subtracted exactly once, however old it is.

### Rejection is per evaluation until settled

Before settlement, applied and rejected are a pure function of the inputs. They are not a property of the spend. If the candidate set changes — a late older spend arrives and takes an earlier position — the result MAY change for spends after it, and every reader with the new set derives the new result. Readers MUST NOT remember a rejection as permanent on their own.

Settlement is what makes a rejection permanent, and it is the owner's job. When the owner folds, it SHOULD `void` every spend it evaluated as rejected. A voided spend is never applied again against any later snapshot, whatever balance that snapshot holds. A rejected spend the owner does not void remains pending and is re-evaluated against the next snapshot; if that snapshot holds enough, it applies then. Owners that want the "an overdraw is final" semantics MUST void.

### Duplicate delivery

Relays return copies. Two events with the same id are one spend; implementations MUST deduplicate by id before anything else. (Two events with the same id and different content cannot both carry valid signatures; signature verification is the transport layer's job and is assumed here.)

---

## kind:1417 — Game Inventory Fold Manifest

### Purpose

A `kind:1417` event answers:

```text
Which spends against 31633:<owner>:<d> has the snapshot lineage that
references me already settled, and which manifest settled the ones before?
```

### Event kind

`1417` is a regular event. It is immutable and append-only. Manifests for one inventory form a chain through `previous` references; the chain is never rewritten, only extended.

A manifest is not a snapshot and holds no quantities. It records decisions: this spend was applied and is inside the snapshot's numbers (`spend`); this spend was rejected and is closed (`void`).

### Author

The event author MUST be the inventory owner named in the inventory reference. A manifest by any other author MUST be rejected.

### Tags

```json
["a", "31633:<owner-pubkey>:<inventory-d-tag>", "<relay-url>", "inventory"]
["e", "<previous-manifest-id>", "<relay-url>", "previous"]
["e", "<spend-id>", "<relay-url>", "spend"]
["e", "<spend-id>", "<relay-url>", "void"]
["alt", "<human-readable fallback>"]
```

- Exactly one `a` tag marked `inventory` is REQUIRED. It scopes the manifest to one inventory address.
- At most one `e` tag marked `previous`. It references the previous manifest for the same inventory. The first manifest of an inventory has none.
- Any number of `e` tags marked `spend`: applied spends this manifest incorporates.
- Any number of `e` tags marked `void`: rejected spends this manifest settles as permanently not applicable.
- At least one `spend` or `void` reference is REQUIRED. A manifest that settles nothing is not a manifest.
- `alt` is OPTIONAL.

`e` tags with no marker or other markers are unrelated and MUST be ignored. Unknown tags MUST be tolerated.

### Structural rules

A manifest MUST NOT:

- reference the same spend id twice, whether as `spend` twice, `void` twice, or once each;
- reference its `previous` id also as a `spend` or `void`;
- reference itself.

Each of these is a **rejection**, not a deduplication. A manifest that is ambiguous about what it settled is ambiguous about the snapshot's quantities, and that is not a case where a reader should guess.

### Content rules

These rules concern what the manifest references and cannot be verified from the event alone; they are verified during [fold-chain resolution](#fold-chain-resolution). A manifest MUST NOT:

- reference a spend that is not structurally valid;
- reference a spend whose author is not the inventory owner (this is the same condition, since a spend's author must equal its inventory owner and the manifest's inventory must equal the spend's);
- reference a spend against a different inventory address;
- list as `spend` a spend that was rejected under the deterministic derivation against the base it folded from;
- list as `spend` or `void` a spend already reachable through its `previous` chain.

### Content

`content` SHOULD be an empty string. It MAY contain JSON metadata; it MUST NOT be required to interpret the manifest.

### Example: first manifest

```json
{
  "kind": 1417,
  "pubkey": "<player>",
  "content": "",
  "tags": [
    ["a", "31633:<player>:farm:main", "wss://relay.example", "inventory"],
    ["e", "<spend-1>", "wss://relay.example", "spend"],
    ["e", "<spend-2>", "", "spend"],
    ["e", "<spend-3>", "", "void"],
    ["alt", "Folded 2 spends into the farm inventory"]
  ]
}
```

### Example: chained manifest

```json
{
  "kind": 1417,
  "pubkey": "<player>",
  "content": "",
  "tags": [
    ["a", "31633:<player>:farm:main", "", "inventory"],
    ["e", "<manifest-1>", "wss://relay.example", "previous"],
    ["e", "<spend-4>", "", "spend"]
  ]
}
```

### Invalid examples

Wrong author — MUST be rejected:

```json
{
  "kind": 1417,
  "pubkey": "<attacker>",
  "tags": [
    ["a", "31633:<player>:farm:main", "", "inventory"],
    ["e", "<spend-1>", "", "spend"]
  ]
}
```

Same spend twice — MUST be rejected:

```json
["e", "<spend-1>", "", "spend"]
["e", "<spend-1>", "", "spend"]
```

Folded and voided — MUST be rejected:

```json
["e", "<spend-1>", "", "spend"]
["e", "<spend-1>", "", "void"]
```

No references — MUST be rejected:

```json
{ "kind": 1417, "tags": [["a", "31633:<player>:farm:main", "", "inventory"]] }
```

A manifest scoped to `31633:<player>:farm:main` referencing a spend whose inventory is `31633:<player>:blobbi:island` — MUST fail chain verification (the manifest itself parses; the chain does not resolve).

### Validation rules for kind:1417

A client or library MUST reject a `kind:1417` event as a manifest if any of the following holds:

```text
kind is not 1417
the event has no id
there is not exactly one a tag marked inventory
the inventory address is malformed or does not reference kind 31633
event.pubkey is not the inventory address's owner pubkey
there is more than one e tag marked previous
a previous, spend or void reference has a blank id
there is no spend or void reference at all
the same id is referenced more than once across spend and void
the previous id is also referenced as spend or void
any reference names the manifest's own id
```

---

## Changes to kind:31633

A `kind:31633` snapshot MAY carry exactly one fold reference:

```json
["e", "<fold-manifest-id>", "<relay-url>", "fold"]
```

Its meaning:

```text
The quantities encoded in this snapshot already incorporate every spend listed
as `spend` in the referenced manifest and in every manifest reachable through
its `previous` chain, and every spend listed as `void` anywhere in that chain
is permanently not applicable.
```

- A snapshot with no fold reference has incorporated no spend. Every valid spend against it is pending. This is the state of every inventory written before this NIP and of every inventory that has never folded, and it is fully valid.
- A snapshot MUST NOT carry more than one fold reference. A permissive parser SHOULD keep the first and warn; a strict parser MAY reject.
- A snapshot that folds new spends MUST reference the new manifest. A snapshot that folds nothing new MUST keep referencing the manifest its base referenced. Dropping the reference would make every spend in the chain pending again and debit the owner a second time.

`kind:31633` is otherwise unchanged. It remains the replaceable, owner-authored, per-context snapshot whose tags are the source of truth. What this NIP changes is how a reader should interpret its quantities: they are the **last consolidated** state, not necessarily the current effective state. A pending spend makes them temporarily stale until the owner's next snapshot folds it. See [Backward compatibility](#backward-compatibility).

### Relationship to `revision`

`revision` is the advisory counter defined for `kind:31633`. It is unrelated to folds and MUST NOT be reused as one:

```text
revision is not a lock, not compare-and-swap, not a spend order,
and not evidence that any spend was folded
```

A snapshot that folds spends is an ordinary replacement and follows the ordinary revision rules — a writer that uses revisions publishes `previous + 1`. Whether the replacement folded anything is stated by the fold reference alone. Two snapshots with the same revision and different fold references are a `conflict` exactly as two snapshots with the same revision and different items would be.

### Relationship to the verification model

The existing `kind:31633` text describes an optional verification model where a client compares declared quantities against grants and spends. `kind:1416` is the spend event that model anticipated. Grants remain undefined by this NIP.

---

## Fold-chain resolution

To interpret a snapshot, a reader resolves its fold chain:

```text
1. if the snapshot has no fold reference: the chain is empty; folded = {}, voided = {}; done.
2. next := the referenced manifest id; visited := {}.
3. while next is defined:
     if next in visited: fail (cycle).
     add next to visited.
     fetch the event with id next; if unavailable: fail (missing manifest).
     parse it as kind:1417; if invalid: fail (invalid manifest).
     if its inventory address != the snapshot's address: fail (wrong inventory).
     add its spend ids to folded and its void ids to voided.
     next := its previous id (or undefined).
4. the chain is resolved.
```

The walk is head-first (newest manifest first). Because a manifest is authored by the owner of the inventory it names, a manifest whose inventory address matches is necessarily authored by the snapshot's owner; implementations SHOULD still check the author as defence in depth.

### On failure

If resolution fails, the reader does not know which spends the snapshot has incorporated. A reader MUST NOT then:

- treat unknown spends as folded (this hides real debits);
- treat every spend as pending (this debits the owner twice for spends the snapshot already incorporated);
- invent a balance by any other rule.

A reader SHOULD surface an explicit **unresolved** state, fetch the missing manifests using the relay hints on the fold reference and on each `previous` link, and resolve again. Whether to show the raw snapshot quantities in the meantime, and how to label them, is application policy; the raw quantities are the last consolidated state and are an honest thing to display as such. What an application MUST NOT do is present a derived number as the effective balance when the chain is unresolved.

### Anomalies that do not fail resolution

- The same spend id reachable from two manifests in the chain, or listed as `spend` in one and `void` in another. The reader still excludes the id exactly once (the newest manifest's classification is used), so its derivation is unaffected. The owner's own quantities may be wrong, which the owner can correct with a later snapshot; readers SHOULD report the anomaly.
- A referenced spend the reader has not fetched. Absence from one reader's event set is never evidence that the event does not exist; the id is still settled.

### Anomalies that do fail resolution when detected

When the reader has the referenced spend events, it SHOULD verify them: a `spend` or `void` reference to an event that is not a valid spend, or to a valid spend against another inventory address, is a manifest that claims to have settled something it could not have. Such a chain SHOULD be treated as unresolved.

### Compaction

A manifest is not required to chain to its predecessor. An owner MAY publish a manifest with no `previous` that lists every spend id still needed, and reference it from the next snapshot. The old chain becomes unreachable and no reader needs it. This is how an owner repairs a broken chain and how a chain is kept from growing without bound. The only rule is the invariant: the referenced chain must reach every spend the snapshot's quantities incorporate.

---

## Publication order

A manifest and the snapshot that references it are two events, and Nostr has no way to publish them atomically. The order matters because the two failure modes are not symmetric:

```text
a manifest that exists and is referenced by no snapshot is harmless:
    it settles nothing, and its spends stay pending relative to the current snapshot;

a snapshot that references a manifest readers cannot retrieve is harmful:
    readers cannot prove what it incorporated and cannot derive a balance.
```

Therefore an owner MUST:

```text
1. sign and publish the kind:1417 manifest;
2. wait for at least one relay to accept it;
3. then publish the kind:31633 snapshot referencing it.
```

An owner SHOULD publish the snapshot to the same relays that accepted the manifest, and SHOULD put one of those relays in the fold reference's relay slot.

### Recovery

- **Manifest accepted, snapshot publish fails.** Safe. The manifest is an orphan. The spends it lists are still pending relative to the current (old) snapshot, and every reader derives the same balance it derived before. The owner MAY retry publishing the same snapshot, or MAY start over: re-derive from the current snapshot, build a new manifest, and publish both. The orphan is never referenced and never consulted.
- **Snapshot accepted, manifest not on a relay the reader uses.** The reader reaches the unresolved state above and fetches by id from the relay hint. The owner SHOULD have published both to the same relays; a reader SHOULD try the hinted relay and its usual relays before giving up.
- **Spend publish ambiguous.** See [Retry and idempotency](#retry-and-idempotency): find by id, republish the same event, never re-sign.

---

## The owner's fold cycle

Folding happens when the owner is already going to replace the snapshot. No background service, separate processor, or synchronous coordinator is required or assumed.

```text
1. read the current snapshot;
2. resolve its fold chain (fetch the referenced manifest and its previous links);
3. read the candidate spends against the inventory address;
4. derive: pending spends -> applied / rejected, and the effective quantities;
5. apply the owner's own mutation, if any, to the effective quantities;
6. build one kind:1417 listing every applied spend as `spend` and every
   rejected spend as `void`, with previous = the snapshot's current fold
   reference (if any);
7. publish the manifest;
8. publish the new kind:31633 with the resulting quantities and a fold
   reference to the new manifest.
```

If step 4 yields no applied and no rejected spends, steps 6–7 are skipped and the new snapshot keeps the previous fold reference.

### Batching is policy

The protocol does not require a fold per spend, a fold per N spends, or a fold per interval. An owner MAY fold:

- whenever it replaces the snapshot anyway (the normal case);
- after a threshold of pending spends;
- as periodic maintenance;
- as compaction.

The pending queue is the set of unsettled `kind:1416` events themselves. This NIP defines **no** replaceable "pending spends" buffer, and an implementation MUST NOT require one: any such event would be one more replaceable thing for two writers to clobber.

---

## No timestamp watermark

This NIP deliberately does **not** define a rule of the form "every spend with `created_at` before T is folded", and no `["spends_until", T]` tag.

Relay sets are eventually consistent. A spend can be signed at time 10, reach one relay at once, and reach the owner's relay at time 100 — after the owner has already folded at time 50 and published a snapshot at time 60. Under a watermark of 50 that spend, arriving later, would be classified as already folded, and the player's debit would silently vanish. Under explicit ids it is simply not in any manifest, so it is pending, and it is applied against the current snapshot exactly once.

`created_at` decides the **order** of pending spends. It never decides whether a spend is **settled**. Implementers tempted to "optimise" resolution by comparing timestamps against the manifest or snapshot time are optimising away correctness.

## Relay disagreement and incomplete sets

Readers MUST assume that:

- different relays hold different subsets of spends and manifests;
- any event can arrive late, including one older than the current snapshot;
- an event that is not on the relays a reader queried may still exist;
- a spend's `created_at` says nothing about whether it has been settled.

Given an event set, a reader can claim: "against this snapshot and this chain, these are the applied and rejected spends, and this is the effective balance, for the spends I have". It cannot claim that the balance is globally final, and this NIP does not offer consensus or strong consistency. Libraries SHOULD make the unresolved state, the unverified references, and the deduplicated copies visible rather than collapsing them into a number.

---

## Security model

**Spend authority.** A spend is authorised for accounting when, and only when, `spend.pubkey` equals the owner pubkey inside the inventory address it references. This is a signature check on a player key. It says nothing about which application produced the event. A `client` tag is a free-form string and MUST NOT be treated as authorisation of anything.

**Item trust.** This NIP does not decide whether a consuming game should honour an item definition, an issuer, or a source inventory. That remains application policy, exactly as it is for reading a `kind:31633` snapshot.

**Inventory ownership and the one-writer convention.** The protocol cannot stop a player, or a modified client holding the player's key, from publishing a replacement `kind:31633` for any of their own inventories, or a manifest that voids their own spends. "One replacement writer per inventory context" is a coordination convention to avoid lost updates between honest applications; it is not a cryptographic restriction, and a spend-based game that needs to trust balances beyond what the player asserts needs issuer-side accounting that is out of scope here.

**Relay incompleteness.** Absence of an event from a relay is never evidence that it does not exist. Neither a reader nor an owner may conclude "no spend exists" from a single relay's answer.

## Residual concurrency limitations

The spend model removes one class of lost update: an application other than the owner no longer needs to replace the snapshot to debit it. It does **not** provide compare-and-swap for `kind:31633`, and it does not change what happens when the owner itself is running twice.

Two owner instances (two devices, two tabs on different origins) that both read the same snapshot, both derive, both build a manifest, and both publish a replacement will race exactly as they did before this NIP. The manifests do not make this worse: each is scoped to the same inventory, chains to the same `previous`, and lists spends that the other instance also lists or leaves pending. Readers exclude a spend once whichever chain wins, so no reader double-debits. What is lost is the losing instance's own mutation — the harvest, the crafted item — which is the pre-existing replaceable-event hazard that `revision` lets a later reader detect and nothing here prevents. Same-origin instances SHOULD serialise with a local lock; cross-origin instances have no such lock and SHOULD keep one designated writer.

## Why the manifest does not reference the base snapshot

A manifest could carry the event id of the snapshot it was derived from. This NIP does not define such a reference, for three reasons:

1. **It cannot be verified.** Relays keep only the newest `kind:31633` per address. A reader cannot fetch the replaced base event, so a base reference is an unverifiable claim.
2. **The invariant does not need it.** What a reader must know is which spends the _current_ snapshot incorporates. The inventory address plus the `previous` chain answers that completely; which base the owner started from does not change the set of settled ids.
3. **The writer already has `revision`.** The only party that could use a base reference is the owner, at build time, to check that the head has not moved. That is precisely what reading the base and publishing `revision + 1` is for.

A future version MAY add an informational base reference; readers MUST already tolerate unknown tags, so nothing here would break.

## Rationale and non-goals

- **Explicit ids, not commitments.** Hash chains, XOR accumulators, and Merkle roots can make a manifest smaller and let a reader check membership without the full list. They also make a manifest unreadable without tooling and unauditable without the pre-image set. Version 1 chooses the explicit, auditable list; a compact manifest MAY be defined later as an alternative reference type.
- **Spend only, not "operation".** This kind is a debit. Generalising it into an operation kind with a `type` field would force every reader to understand every future type before it could trust any balance. Grants, transfers, reservations, conversions, and crafting are out of scope and, when defined, will be their own kinds.
- **No batch spends.** See [One item per event](#one-item-per-event).
- **No mutable queue.** See [Batching is policy](#batching-is-policy).
- **No timestamp watermark.** See [No timestamp watermark](#no-timestamp-watermark).
- **No cross-origin lock requirement, no background service.** Folding happens on the owner's next write.

## Backward compatibility

- Every `kind:31633` inventory without a fold reference remains valid and parses exactly as before. Existing parsers, builders, mutation helpers, revisions, and lossless round-tripping are unaffected.
- A client that does not understand `kind:1416` and `kind:1417` sees the last consolidated snapshot. Until the owner folds, that client may **over-report** the quantity of an item that has pending spends. This is a real, temporary limitation of the version transition, and it is accepted: the raw snapshot is still the owner's last consolidated statement, and folding makes it current again.
- A client that understands this NIP MUST apply the derivation in this document to every `kind:31633` it reads, including ones with no fold reference.
- A `kind:31633` writer that does not understand this NIP but round-trips unknown tags will carry the fold reference through unchanged, which is correct. A writer that rebuilds from a few fields and drops it will un-fold the chain — the same data-loss hazard the `kind:31633` specification already warns about, with the same remedy: preserve what you do not understand.

## Worked examples

Snapshot quantities are for `31632:<farm-issuer>:farm:crop:strawberry` in `31633:<player>:farm:main`. `S<n>` are spends by `<player>` of quantity 1 unless stated; `M<n>` are manifests.

1. **Simple spend.** Snapshot 3, no fold. S1 arrives. Effective 2. S1 is applied and pending.
2. **Fold.** Snapshot 3, S1 and S2 pending. Owner folds: M1 = {spend S1, spend S2}; new snapshot 1 with fold → M1. A reader derives 1 − (nothing pending) = 1. S1 and S2 are folded and MUST NOT be subtracted again.
3. **Later spend.** After example 2, S3 arrives. Not in M1's chain, so pending. Effective 1 − 1 = 0.
4. **Late old event.** M1 was built having seen S1 and S3 and lists both; snapshot 1 → M1. A relay later delivers S2, with `created_at` between S1 and S3 and before M1. S2 is not reachable from M1, so it is pending: effective 1 − 1 = 0. A timestamp watermark would have hidden S2 forever.
5. **Concurrent overdraw.** Snapshot 1; S1 and S2 both request 1 with the same `created_at`. The lower id applies; the other is rejected. Every implementation converges on the same winner. When the owner folds, it lists the winner as `spend` and the loser as `void`.
6. **Wrong author.** A spend against `31633:<player>:farm:main` signed by `<attacker>` is structurally invalid. It is not pending, not applied, not rejected; it does not exist for accounting.
7. **Wrong inventory in a manifest.** M1 scoped to `farm:main` lists a spend whose inventory is `blobbi:island`. A reader with that spend event fails chain verification.
8. **Missing manifest.** Snapshot → M1, and M1 cannot be retrieved. The reader reports unresolved and derives no balance. It does not assume M1 was empty, and it does not assume every spend is pending.
9. **Orphan manifest.** M2 exists and no current snapshot references it. It settles nothing; every spend it lists is pending relative to the current snapshot.

## Library functions

A `@nostr-games/inventory` package SHOULD expose helpers similar to:

```ts
export const KIND_GAME_INVENTORY_SPEND = 1416;
export const KIND_GAME_INVENTORY_FOLD = 1417;

// kind:1416
export function parseGameInventorySpend(
  event: NostrEvent,
): GameInventorySpend | null;
export function buildGameInventorySpendEvent(input: {
  inventoryAddress: string; // full 31633:<owner>:<d>
  itemAddress: string; // full 31632:<issuer>:<d>
  quantity: number; // positive integer
  purpose?: string;
  client?: string;
  nonce?: string;
  alt?: string;
}): { kind: 1416; content: string; tags: string[][] };
export function compareGameInventorySpendOrder(a, b): number; // (created_at, id)
export function sortGameInventorySpends(spends): GameInventorySpend[];
export function buildGameInventorySpendFilter(options?: {
  ids?: string[];
  authors?: string[];
  inventoryAddresses?: string[];
  itemAddresses?: string[];
}): { kinds: [1416]; ids?; authors?; "#a"? };

// Derivation (pure; no fetching)
export function deriveGameInventoryState(input: {
  inventory: GameInventory;
  spends: NostrEvent[];
  foldedSpendIds?: Iterable<string>;
  voidedSpendIds?: Iterable<string>;
}): GameInventoryDerivedState; // effective inventory + applied/rejected/folded/voided/ignored/invalid

// kind:1417
export function parseGameInventoryFold(
  event: NostrEvent,
): GameInventoryFold | null;
export function buildGameInventoryFoldEvent(input: {
  inventoryAddress: string;
  previous?: { eventId: string; relay?: string };
  spends?: { eventId: string; relay?: string }[];
  voids?: { eventId: string; relay?: string }[];
}): { kind: 1417; content: string; tags: string[][] };
export function toBuildGameInventoryFoldInput(
  state: GameInventoryDerivedState,
): BuildGameInventoryFoldInput | null;
export function buildGameInventoryFoldFilter(options?: {
  ids?: string[];
  authors?: string[];
  inventoryAddresses?: string[];
}): { kinds: [1417]; ids?; authors?; "#a"? };

// Chain resolution and the reader's entry point (pure; no fetching)
export function resolveGameInventoryFoldChain(input: {
  inventoryAddress: string;
  headFoldId?: string;
  folds: NostrEvent[];
  spends?: NostrEvent[];
}): GameInventoryFoldResolution; // resolved | unresolved, with folded/voided ids, problems, warnings
export function resolveGameInventoryState(input: {
  inventory: GameInventory;
  folds: NostrEvent[];
  spends: NostrEvent[];
}): { status: "resolved"; chain; state } | { status: "unresolved"; chain };
```

### The recommended owner cycle

```ts
const base = parseGameInventory(snapshotEvent);
const r = resolveGameInventoryState({ inventory: base, folds, spends });
if (r.status !== "resolved") {
  // fetch the manifests named in r.chain.problems and try again
}
const next = addInventoryItemQuantity(r.state.inventory, harvested, 2); // own mutation

const foldInput = toBuildGameInventoryFoldInput(r.state); // null when nothing to settle
const manifest = foldInput && buildGameInventoryFoldEvent(foldInput);
// sign + publish `manifest`, wait for acceptance, obtain its id …

const unsigned = buildGameInventoryEvent({
  ...toBuildGameInventoryInput(next), // keeps the previous fold reference
  ...(manifest ? { fold: { eventId: manifestId } } : {}),
  revision: (next.revision ?? 0) + 1,
});
```

## Final decisions

```text
Kind: 1416
Name: Game Inventory Spend
Type: regular (immutable, append-only)
Author: inventory owner (MUST equal the owner in the inventory address)
Identity: event id
Required tags:
  ["a", "31633:<owner>:<inventory-d>", "<relay>", "inventory"]  exactly one
  ["a", "31632:<issuer>:<item-d>", "<relay>", "item"]           exactly one
  ["quantity", "<positive-integer>"]                              exactly one
Optional tags: purpose, client, nonce, alt (never affect accounting)
One item per event; debit only
Order: (created_at asc, id asc)
Overdraw: rejected in full; never partial, never clamped

Kind: 1417
Name: Game Inventory Fold Manifest
Type: regular (immutable, append-only)
Author: inventory owner
Identity: event id; chained through previous
Required tags:
  ["a", "31633:<owner>:<inventory-d>", "<relay>", "inventory"]  exactly one
  ["e", "<spend-id>", "<relay>", "spend"] / ["e", "<spend-id>", "<relay>", "void"]  at least one in total
Optional tags: ["e", "<previous-manifest-id>", "<relay>", "previous"] at most one; alt
Duplicate references: reject
Base snapshot reference: none in this version

kind:31633 addition: ["e", "<fold-manifest-id>", "<relay>", "fold"], at most one
Effective balance: snapshot − applied spends not reachable through the fold chain
Publication order: manifest first, then the snapshot that references it
Unresolved chain: report; never derive a balance
Watermark: none; settlement is by explicit id only
Not defined: grants, transfers, reservations, conversions, crafting, batch spends,
             pending buffers, commitments, cross-origin locks, base references
```
