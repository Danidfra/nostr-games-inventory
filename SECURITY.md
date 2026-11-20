# Security

This document states what `@nostr-games/inventory` defends against, what it
leaves to the caller, and which integrity limits no library can remove from a
Nostr inventory. The protocol documents in [`docs/`](./docs) remain the
normative source; this is the operational summary.

## Reporting a vulnerability

Please report suspected vulnerabilities privately through GitHub's
"Report a vulnerability" form on this repository (Security tab), not in a
public issue. Include the library version, a minimal event or input that
reproduces the problem, and the observed result.

## Untrusted input

Every event this library parses may come from a hostile publisher or relay.
The library guarantees:

- **Parsers and validators never throw on event data.** An event that is not
  NIP-01-shaped (not an object, an empty or non-string `pubkey`, `tags` that
  are not arrays of strings, a non-string `content`) is rejected with
  `malformed-event`. Builders and mutation helpers still throw on caller bugs,
  as documented in the README.
- **Bounded structure.** kind:31634 `content` nested deeper than 64 levels is
  rejected (`content-too-deep`). No recursive walk in the library depends on
  input depth, and every value it hands out can be walked by recursive code
  such as `JSON.stringify`.
- **No prototype tricks.** Copies never change their prototype, and
  `Object.prototype` is never modified. kind:31634 entries, targets and
  references that contain a `__proto__` key are malformed. Elsewhere, for
  example in `contentJson` or in an unknown top-level field, a `__proto__` key
  is kept as an ordinary own property, exactly as `JSON.parse` produced it.
  If your code copies such raw objects with `Object.assign` or a deep-merge
  helper, apply your own key filter.
- **No coercion.** Quantities, revisions, coordinates and kind:1416/1417
  `created_at` values are checked as the specs define them; `NaN`,
  `Infinity`, numeric strings and fractions never pass as numbers.
- **Linear cost.** Parsing and derivation are linear in the size of the input
  (deduplication and duplicate tracking use sets and maps).

Not limited by the library: the total size of an event, the number of tags,
items or placement entries, the number of candidate spends, and the length of
a fold chain. Each costs time proportional to its size, so bound what you
accept at the transport layer (relay limits, a maximum `content` length, a
maximum number of events per query) according to your application's budget.

## Caller responsibilities

- **Verify signatures (P-04).** The library does not verify `id` or `sig`.
  It compares `event.pubkey` with the owner pubkey in the referenced
  inventory address, which is only meaningful for an event whose signature
  your relay client or signer has verified. Without verification anyone can
  forge an owner's spend, manifest, inventory or placement. This includes
  same-id copies: the spec deduplicates kind:1416/1417 events by id _before_
  validation, so an unverified, mangled copy delivered first can displace the
  genuine event (un-applying a spend, or leaving a fold chain unresolved).
  Verify every event before passing it in.
- **Use canonical keys and ids when you can.** `requireHexPubkey` and
  `requireHexEventId` reject non-canonical values that verification would
  also reject.
- **Decide trust.** Whether an item issuer is trusted, whether an author may
  modify a placement target, and whether anything should render are
  application policy.

## Distributed integrity limits

These follow from Nostr itself. A correct implementation can make them
visible; it cannot make them disappear.

- **Incomplete histories.** Relays hold different subsets of events, may
  return partial results, and apply default result limits. A derived balance
  is correct for the events you supplied, not globally final. A truncated
  spend set over-reports the balance; a truncated fold set leaves the chain
  `unresolved`. Query to EOSE on every relay you rely on, page with
  `until`/`since` rather than trusting one response, and treat a silent or
  failing relay as "unknown", never as "no events".
- **Deletion requests (NIP-09).** An owner can ask relays to delete their own
  kind:1416 spends or kind:1417 manifests. Relays that honour the request stop
  serving them: a deleted spend that was not yet folded disappears from every
  later derivation (the debit is undone), and a deleted manifest makes every
  chain through it `unresolved`. The protocol cannot stop an owner from
  deleting their own events, so balances asserted only by the owner are only
  as trustworthy as the owner. Games that need stronger guarantees need
  issuer-side accounting.
- **Concurrent spending from two devices.** Spends are ordered by
  `(created_at, id)` and the last unit goes to the first. A spend from another
  device with an earlier `created_at` that reaches the relays later (offline
  device, slow relay, clock skew) can take the unit retroactively, turning a
  spend you already acted on into `rejected`. Re-reading after publishing
  narrows the window; nothing closes it. Owner instances that both replace
  the kind:31633 snapshot still race: `revision` lets a later reader notice,
  nothing prevents it.
- **Equal timestamps.** `created_at` has one-second resolution and is chosen
  by the publisher. Spends with the same `created_at` are ordered by event id,
  which is deterministic but arbitrary: a publisher who grinds ids or picks
  timestamps can influence which of two concurrent spends wins. Revision
  comparison never uses `created_at` for this reason.
- **Replaceable snapshots.** Relays keep only the newest kind:31633 per
  address. An older snapshot, and anything only it referenced, cannot be
  recovered from relays.

## Supply chain

The published package has no runtime dependencies. CI runs with a read-only
token, pins every action to a commit SHA, and fails if a runtime dependency
with a known high or critical advisory is added. `prepublishOnly` runs
typecheck, lint, format check, tests and a fresh build before any publish.
