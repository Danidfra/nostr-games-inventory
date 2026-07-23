/**
 * Minimal structural type compatible with a signed Nostr event.
 *
 * We intentionally define this locally instead of depending on a full Nostr
 * library. Any object that structurally matches this shape (for example, the
 * event type from `nostr-tools`) is accepted.
 */
export interface NostrEvent {
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig?: string;
  id?: string;
}

/**
 * An unsigned event template as produced by the builders in this library.
 *
 * Builders never create `id` or `sig` and never sign anything. The template is
 * intended to be passed to a signer / relay client by the consuming
 * application.
 *
 * `pubkey` and `created_at` are intentionally omitted: they are added by the
 * signing/publishing layer, which is out of scope for this library.
 */
export interface UnsignedEventTemplate<K extends number = number> {
  kind: K;
  content: string;
  tags: string[][];
}
