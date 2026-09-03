import {
  buildGameInventorySpendEvent,
  buildGameInventoryFoldEvent,
  buildGameInventoryEvent,
  parseGameInventory,
  KIND_GAME_INVENTORY,
  type NostrEvent,
  type GameInventory,
  type BuildGameInventoryEventReferenceInput,
} from "../src/index.js";
import { makeEvent } from "./helpers.js";

export const OWNER = "owner";
export const ATTACKER = "attacker";
export const FARM = "31633:owner:farm:main";
export const ISLAND = "31633:owner:blobbi:island";
export const STRAWBERRY = "31632:issuer:farm:crop:strawberry";
export const CARROT = "31632:issuer:farm:crop:carrot";

export interface SpendSpec {
  id: string;
  createdAt?: number;
  pubkey?: string;
  inventory?: string;
  item?: string;
  quantity?: number;
}

/**
 * A signed-looking kind:1416 event built through the real builder.
 */
export function spendEvent(spec: SpendSpec): NostrEvent {
  const template = buildGameInventorySpendEvent({
    inventoryAddress: spec.inventory ?? FARM,
    itemAddress: spec.item ?? STRAWBERRY,
    quantity: spec.quantity ?? 1,
  });
  return makeEvent({
    ...template,
    id: spec.id,
    pubkey: spec.pubkey ?? OWNER,
    created_at: spec.createdAt ?? 1_700_000_000,
  });
}

export interface FoldSpec {
  id: string;
  createdAt?: number;
  pubkey?: string;
  inventory?: string;
  previous?: string;
  spends?: string[];
  voids?: string[];
}

function refs(
  ids: string[] | undefined,
): BuildGameInventoryEventReferenceInput[] {
  return (ids ?? []).map((eventId) => ({ eventId }));
}

/**
 * A signed-looking kind:1417 event built through the real builder.
 */
export function foldEvent(spec: FoldSpec): NostrEvent {
  const template = buildGameInventoryFoldEvent({
    inventoryAddress: spec.inventory ?? FARM,
    ...(spec.previous !== undefined
      ? { previous: { eventId: spec.previous } }
      : {}),
    spends: refs(spec.spends),
    voids: refs(spec.voids),
  });
  return makeEvent({
    ...template,
    id: spec.id,
    pubkey: spec.pubkey ?? OWNER,
    created_at: spec.createdAt ?? 1_700_000_000,
  });
}

export interface SnapshotSpec {
  id?: string;
  items?: Record<string, number>;
  fold?: string;
  revision?: number;
  extraTags?: string[][];
}

/**
 * A parsed kind:31633 snapshot for `31633:owner:farm:main`.
 */
export function snapshot(spec: SnapshotSpec = {}): GameInventory {
  const template = buildGameInventoryEvent({
    id: "farm:main",
    items: Object.entries(spec.items ?? {}).map(([address, quantity]) => ({
      address,
      quantity,
    })),
    ...(spec.fold !== undefined ? { fold: { eventId: spec.fold } } : {}),
    ...(spec.revision !== undefined ? { revision: spec.revision } : {}),
    ...(spec.extraTags !== undefined ? { extraTags: spec.extraTags } : {}),
  });
  const inventory = parseGameInventory(
    makeEvent({
      ...template,
      kind: KIND_GAME_INVENTORY,
      id: spec.id ?? "snapshot",
      pubkey: OWNER,
    }),
  );
  if (inventory === null) {
    throw new Error("fixture snapshot did not parse");
  }
  return inventory;
}

export function quantityOf(inventory: GameInventory, address: string): number {
  return (
    inventory.items.find((item) => item.address === address)?.quantity ?? 0
  );
}
