import type { UnsignedEventTemplate } from "../../nostr/event.js";
import {
  KIND_GAME_INVENTORY_FOLD,
  KIND_GAME_INVENTORY,
  type KindGameInventoryFold,
} from "../../common/constants.js";
import { serializeContent } from "../../common/json.js";
import { isBlank } from "../../common/strings.js";
import {
  INVENTORY_MARKER,
  parseGameInventoryAddress,
} from "../game-inventory/address.js";
import type { GameInventoryDerivedState } from "../game-inventory-spend/types.js";
import {
  FOLD_PREVIOUS_MARKER,
  FOLD_SPEND_MARKER,
  FOLD_VOID_MARKER,
} from "./constants.js";
import type {
  BuildGameInventoryEventReferenceInput,
  BuildGameInventoryFoldInput,
} from "./types.js";

const MANAGED_TAG_NAMES = new Set<string>(["a", "e", "alt"]);

/**
 * Build an unsigned kind:1417 Game Inventory Fold Manifest template.
 *
 * The builder:
 * - requires a full `31633:<owner>:<d>` inventory address;
 * - requires at least one spend or void reference: an empty manifest settles
 *   nothing and is not a valid fold;
 * - rejects a blank id anywhere, the same id referenced twice, and a
 *   `previous` id that is also a spend or void;
 * - never creates `id` or `sig`, and never decides who signs. The signer MUST
 *   be the inventory owner named in `inventoryAddress`.
 *
 * Emitted tag order is fixed and deterministic:
 *
 * ```text
 * a(inventory) -> e(previous) -> e(spend)* -> e(void)* -> alt -> extraTags
 * ```
 *
 * The builder cannot know whether the referenced spends are valid,
 * applicable, or already settled; use {@link toBuildGameInventoryFoldInput} on
 * a derived state to obtain references that are, by construction.
 *
 * @throws {Error} for an invalid inventory address, no references, a blank or
 * duplicated id, or an `extraTags` entry that conflicts with a managed tag.
 */
export function buildGameInventoryFoldEvent(
  input: BuildGameInventoryFoldInput,
): UnsignedEventTemplate<KindGameInventoryFold> {
  if (parseGameInventoryAddress(input.inventoryAddress) === null) {
    throw new Error(
      `buildGameInventoryFoldEvent: \`inventoryAddress\` must be a kind:${KIND_GAME_INVENTORY} coordinate, got: ${String(input.inventoryAddress)}`,
    );
  }

  const spends = input.spends ?? [];
  const voids = input.voids ?? [];
  if (spends.length + voids.length === 0) {
    throw new Error(
      "buildGameInventoryFoldEvent: a manifest must reference at least one spend or void",
    );
  }

  const tags: string[][] = [
    ["a", input.inventoryAddress, input.inventoryRelay ?? "", INVENTORY_MARKER],
  ];

  const seen = new Set<string>();
  if (input.previous !== undefined) {
    const previousId = requireId(input.previous, "previous");
    seen.add(previousId);
    tags.push([
      "e",
      previousId,
      input.previous.relay ?? "",
      FOLD_PREVIOUS_MARKER,
    ]);
  }
  for (const reference of spends) {
    const id = requireId(reference, "spend");
    assertUnseen(seen, id);
    tags.push(["e", id, reference.relay ?? "", FOLD_SPEND_MARKER]);
  }
  for (const reference of voids) {
    const id = requireId(reference, "void");
    assertUnseen(seen, id);
    tags.push(["e", id, reference.relay ?? "", FOLD_VOID_MARKER]);
  }

  if (input.alt !== undefined && !isBlank(input.alt)) {
    tags.push(["alt", input.alt]);
  }

  for (const tag of input.extraTags ?? []) {
    const name = tag[0];
    if (name !== undefined && MANAGED_TAG_NAMES.has(name)) {
      throw new Error(
        `buildGameInventoryFoldEvent: \`extraTags\` may not contain the builder-managed tag \`${name}\``,
      );
    }
    tags.push([...tag]);
  }

  return {
    kind: KIND_GAME_INVENTORY_FOLD,
    content: serializeContent(input.content),
    tags,
  };
}

function requireId(
  reference: BuildGameInventoryEventReferenceInput,
  label: string,
): string {
  if (isBlank(reference.eventId)) {
    throw new Error(
      `buildGameInventoryFoldEvent: ${label} \`eventId\` must be non-empty`,
    );
  }
  return reference.eventId;
}

function assertUnseen(seen: Set<string>, id: string): void {
  if (seen.has(id)) {
    throw new Error(
      `buildGameInventoryFoldEvent: event id referenced more than once: ${id}`,
    );
  }
  seen.add(id);
}

/**
 * Turn a derived state into the input for the manifest that settles it.
 *
 * This is the owner's normal fold step. Given a state derived from the
 * current snapshot and a RESOLVED fold chain, it references:
 *
 * - every `applied` pending spend as a `spend` — these are, by construction,
 *   valid, scoped to this inventory, not yet settled, and applicable in the
 *   deterministic order;
 * - every `rejected` pending spend as a `void` — so the rejection is settled
 *   and the spend cannot resurface against a later, larger balance;
 * - the snapshot's current fold reference as `previous`.
 *
 * Returns `null` when there is nothing to settle. The owner then publishes no
 * new manifest and the next snapshot keeps referencing the previous one
 * (which `toBuildGameInventoryInput` already does).
 *
 * The derived state MUST have been produced with the folded and voided ids of
 * a resolved chain; deriving against an unresolved chain and folding the
 * result would re-fold spends the snapshot already incorporates.
 */
export function toBuildGameInventoryFoldInput(
  state: GameInventoryDerivedState,
): BuildGameInventoryFoldInput | null {
  if (state.applied.length === 0 && state.rejected.length === 0) {
    return null;
  }
  const input: BuildGameInventoryFoldInput = {
    inventoryAddress: state.base.address,
    spends: state.applied.map((spend) => ({ eventId: spend.id, relay: "" })),
    voids: state.rejected.map((spend) => ({ eventId: spend.id, relay: "" })),
  };
  if (state.base.fold !== undefined) {
    input.previous = {
      eventId: state.base.fold.eventId,
      relay: state.base.fold.relay,
    };
  }
  return input;
}
