import { cloneJsonLike } from "../../common/objects.js";
import { isBlank } from "../../common/strings.js";
import { referenceRequiresZ, validatePlacementEntryValue } from "./content.js";
import type { GameItemPlacement, GameItemPlacementEntry } from "./types.js";

/**
 * Query and immutable mutation helpers for kind:31634.
 *
 * ## Immutability
 *
 * Every mutation helper returns a new {@link GameItemPlacement} and never
 * touches the input, at any depth: entries are deep-copied, so a caller cannot
 * reach back into a parsed placement through a shared nested object.
 *
 * ## What mutation helpers do and do not update
 *
 * They update `placements` and the derived `itemAddresses`. They deliberately
 * carry `content`, `contentJson`, `itemTags`, `targetTags` and `event` through
 * unchanged: those describe the **source event**, and a mutated document is not
 * an event yet. Regenerate everything by rebuilding:
 *
 * ```ts
 * const next = setEquippedPlacementForSlot(placement, "head", entry);
 * const unsigned = buildGameItemPlacementEvent({
 *   ...toBuildGameItemPlacementInput(next),
 *   revision: (next.revision ?? 0) + 1,
 * });
 * ```
 *
 * ## Duplicates
 *
 * Duplicate entry ids and duplicate equipped slots are tolerated by the parser
 * (they only warn), so every helper here states exactly how it treats them
 * rather than assuming they cannot occur.
 */

/* -------------------------------------------------------------------------- */
/* Queries                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Unique item addresses referenced by the placement, in first-placement order.
 *
 * This is the exact set a canonical builder derives `item` tags from.
 */
export function getPlacementItems(placement: GameItemPlacement): string[] {
  return [...placement.itemAddresses];
}

/**
 * The first entry with the given id, or `undefined`.
 *
 * "First" matters only for documents that carry duplicate ids, which the parser
 * reports as `duplicate-placement-id`.
 */
export function getPlacementById(
  placement: GameItemPlacement,
  id: string,
): GameItemPlacementEntry | undefined {
  const found = placement.placements.find((entry) => entry.id === id);
  return found === undefined ? undefined : cloneJsonLike(found);
}

/** Every valid entry placing the given item address, in source order. */
export function getPlacementsByItem(
  placement: GameItemPlacement,
  itemAddress: string,
): GameItemPlacementEntry[] {
  return placement.placements
    .filter((entry) => entry.item === itemAddress)
    .map((entry) => cloneJsonLike(entry));
}

/**
 * Every valid entry using the given slot, in source order — **all modes**, not
 * only `equip`.
 *
 * Use {@link getFirstEquippedPlacementBySlot} or
 * {@link getLastEquippedPlacementBySlot} when you want the single entry that
 * occupies an equipment slot.
 */
export function getPlacementsBySlot(
  placement: GameItemPlacement,
  slot: string,
): GameItemPlacementEntry[] {
  return placement.placements
    .filter((entry) => entry.slot === slot)
    .map((entry) => cloneJsonLike(entry));
}

/**
 * The **first** `mode: "equip"` entry for the slot in source order, or
 * `undefined`.
 */
export function getFirstEquippedPlacementBySlot(
  placement: GameItemPlacement,
  slot: string,
): GameItemPlacementEntry | undefined {
  const found = placement.placements.find(
    (entry) => entry.mode === "equip" && entry.slot === slot,
  );
  return found === undefined ? undefined : cloneJsonLike(found);
}

/**
 * The **last** `mode: "equip"` entry for the slot in source order, or
 * `undefined`.
 *
 * This is the last-wins reading that matches
 * {@link setEquippedPlacementForSlot}, which leaves exactly one equipped entry
 * per slot. There is deliberately no ambiguously-named
 * `getEquippedPlacementBySlot`: the caller states which one it wants.
 */
export function getLastEquippedPlacementBySlot(
  placement: GameItemPlacement,
  slot: string,
): GameItemPlacementEntry | undefined {
  for (let index = placement.placements.length - 1; index >= 0; index -= 1) {
    const entry = placement.placements[index];
    if (entry !== undefined && entry.mode === "equip" && entry.slot === slot) {
      return cloneJsonLike(entry);
    }
  }
  return undefined;
}

/* -------------------------------------------------------------------------- */
/* Mutations                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Append an entry.
 *
 * @throws {Error} when the entry is malformed, or when an entry with the same
 * id already exists — silently creating a duplicate id would make later
 * `replace`/`remove` calls ambiguous. Use {@link replacePlacement} instead.
 */
export function addPlacement(
  placement: GameItemPlacement,
  entry: GameItemPlacementEntry,
): GameItemPlacement {
  const validated = validateEntry(placement, entry, "addPlacement");
  if (placement.placements.some((existing) => existing.id === validated.id)) {
    throw new Error(
      `addPlacement: a placement entry with id \`${validated.id}\` already exists; use replacePlacement`,
    );
  }
  return withPlacements(placement, [
    ...placement.placements.map((e) => cloneJsonLike(e)),
    validated,
  ]);
}

/**
 * Replace the entry with the same id, in place.
 *
 * The replacement keeps the original position, so ordering stays stable. If the
 * document carries duplicate ids only the first occurrence is replaced; the
 * rest are left untouched rather than silently collapsed.
 *
 * @throws {Error} when the entry is malformed or no entry has that id.
 */
export function replacePlacement(
  placement: GameItemPlacement,
  entry: GameItemPlacementEntry,
): GameItemPlacement {
  const validated = validateEntry(placement, entry, "replacePlacement");
  const index = placement.placements.findIndex((e) => e.id === validated.id);
  if (index < 0) {
    throw new Error(
      `replacePlacement: no placement entry with id \`${validated.id}\`; use addPlacement`,
    );
  }
  const next = placement.placements.map((e, i) =>
    i === index ? validated : cloneJsonLike(e),
  );
  return withPlacements(placement, next);
}

/**
 * Remove **every** entry with the given id.
 *
 * Removing by id is exhaustive so the result never leaves a stale duplicate
 * behind. Removing an id that is not present returns an equivalent placement
 * rather than throwing.
 */
export function removePlacement(
  placement: GameItemPlacement,
  id: string,
): GameItemPlacement {
  const next = placement.placements
    .filter((entry) => entry.id !== id)
    .map((entry) => cloneJsonLike(entry));
  return withPlacements(placement, next);
}

/**
 * Set the entry equipped in a slot, with deterministic last-wins semantics.
 *
 * Every existing `mode: "equip"` entry for `slot` is removed and the supplied
 * entry takes the position of the first one removed, so the document ends up
 * with exactly one equipped entry per slot and stable ordering. When the slot
 * was empty the entry is appended.
 *
 * Preserved untouched: entries for other slots, non-`equip` entries that happen
 * to carry the same slot, and every unknown field on both the surviving entries
 * and the supplied one.
 *
 * The entry must be complete: nothing is generated for the caller. `mode` must
 * be `"equip"`, and `slot` must either match or be omitted (in which case it is
 * filled in with `slot`).
 *
 * @throws {Error} for a blank slot, a malformed entry, a non-`equip` mode, or
 * an entry whose `slot` contradicts the requested one.
 */
export function setEquippedPlacementForSlot(
  placement: GameItemPlacement,
  slot: string,
  entry: GameItemPlacementEntry,
): GameItemPlacement {
  if (isBlank(slot)) {
    throw new Error(
      "setEquippedPlacementForSlot: `slot` is required and must be non-empty",
    );
  }
  if (entry.mode !== "equip") {
    throw new Error(
      `setEquippedPlacementForSlot: entry \`mode\` must be "equip", got: ${String(entry.mode)}`,
    );
  }
  if (entry.slot !== undefined && entry.slot !== slot) {
    throw new Error(
      `setEquippedPlacementForSlot: entry \`slot\` (${String(entry.slot)}) does not match the requested slot (${slot})`,
    );
  }

  const validated = validateEntry(
    placement,
    entry.slot === undefined ? { ...entry, slot } : entry,
    "setEquippedPlacementForSlot",
  );

  const next: GameItemPlacementEntry[] = [];
  let inserted = false;
  for (const existing of placement.placements) {
    if (existing.mode === "equip" && existing.slot === slot) {
      if (!inserted) {
        next.push(validated);
        inserted = true;
      }
      continue;
    }
    next.push(cloneJsonLike(existing));
  }
  if (!inserted) {
    next.push(validated);
  }

  return withPlacements(placement, next);
}

/**
 * Remove every `mode: "equip"` entry for the slot.
 *
 * Non-`equip` entries that carry the same slot are preserved: unequipping is
 * not the same as clearing everything associated with a slot. This never
 * changes any inventory: possession is kind:31633's job.
 */
export function removeEquippedPlacementFromSlot(
  placement: GameItemPlacement,
  slot: string,
): GameItemPlacement {
  const next = placement.placements
    .filter((entry) => !(entry.mode === "equip" && entry.slot === slot))
    .map((entry) => cloneJsonLike(entry));
  return withPlacements(placement, next);
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                  */
/* -------------------------------------------------------------------------- */

function validateEntry(
  placement: GameItemPlacement,
  entry: GameItemPlacementEntry,
  label: string,
): GameItemPlacementEntry {
  const result = validatePlacementEntryValue(entry, {
    requireZ: referenceRequiresZ(placement.reference),
  });
  if (!result.ok) {
    throw new Error(`${label}: invalid placement entry: ${result.reason}`);
  }
  return result.value;
}

/**
 * Rebuild the placement around a new entry list, recomputing `itemAddresses`
 * and leaving every source-event field untouched.
 */
function withPlacements(
  placement: GameItemPlacement,
  placements: GameItemPlacementEntry[],
): GameItemPlacement {
  const seen = new Set<string>();
  const itemAddresses: string[] = [];
  for (const entry of placements) {
    if (seen.has(entry.item)) {
      continue;
    }
    seen.add(entry.item);
    itemAddresses.push(entry.item);
  }

  return {
    ...placement,
    contexts: [...placement.contexts],
    topics: [...placement.topics],
    targetTags: placement.targetTags.map((t) => cloneJsonLike(t)),
    itemTags: placement.itemTags.map((t) => cloneJsonLike(t)),
    ...(placement.target === undefined
      ? {}
      : { target: cloneJsonLike(placement.target) }),
    ...(placement.reference === undefined
      ? {}
      : { reference: cloneJsonLike(placement.reference) }),
    placements,
    itemAddresses,
  };
}
