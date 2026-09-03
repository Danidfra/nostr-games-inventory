import type { NostrEvent } from "../../nostr/event.js";
import { isBlank } from "../../common/strings.js";
import { parseGameInventoryAddress } from "../game-inventory/address.js";
import { parseGameInventorySpendResult } from "../game-inventory-spend/parse.js";
import {
  parseGameInventoryFoldResult,
  type ParseGameInventoryFoldOptions,
} from "./parse.js";
import type {
  GameInventoryFold,
  GameInventoryFoldProblem,
  GameInventoryFoldResolution,
  GameInventoryFoldWarning,
  ResolveGameInventoryFoldChainInput,
} from "./types.js";

export type ResolveGameInventoryFoldChainOptions = Pick<
  ParseGameInventoryFoldOptions,
  "requireHexPubkey" | "requireHexEventId"
>;

/**
 * Walk a snapshot's fold chain and collect every spend id it settles.
 *
 * Starting from `headFoldId`, each manifest is looked up by id in `folds`,
 * structurally parsed, checked to be scoped to `inventoryAddress` and
 * authored by its owner, and its `previous` link followed until a manifest
 * with no predecessor is reached. Ids already visited stop the walk with a
 * `cycle` problem, so a corrupt chain can never loop.
 *
 * Any missing, invalid, wrongly scoped or wrongly authored manifest makes the
 * result `unresolved`. This is deliberate: a reader that cannot prove what a
 * snapshot incorporated must not guess. Treating unknown spends as folded
 * would hide real debits; treating them as pending would debit the owner
 * twice. Neither is a balance — so none is produced.
 *
 * When `spends` are supplied, every reachable reference that has an event is
 * verified: a structurally invalid spend or one scoped to another inventory
 * is a problem (the manifest claims to have incorporated something it could
 * not have). A reference with no event is only an `unverified-spend` warning:
 * absence from this reader's set is not evidence the event does not exist.
 *
 * Cross-manifest anomalies that do not change what a reader should subtract —
 * the same spend folded twice, or folded once and voided once — are reported
 * as warnings, not problems. The reader still excludes the spend exactly
 * once; whether the owner's own quantities are right is the owner's
 * responsibility, and a later manifest can compact the chain.
 *
 * This function never fetches anything.
 */
export function resolveGameInventoryFoldChain(
  input: ResolveGameInventoryFoldChainInput,
  options: ResolveGameInventoryFoldChainOptions = {},
): GameInventoryFoldResolution {
  const problems: GameInventoryFoldProblem[] = [];
  const warnings: GameInventoryFoldWarning[] = [];
  const chain: GameInventoryFold[] = [];
  const foldedSpendIds: string[] = [];
  const voidedSpendIds: string[] = [];
  const foldedBy = new Map<string, string>();
  const voidedBy = new Map<string, string>();

  const headFoldId = input.headFoldId;
  const inventory = parseGameInventoryAddress(input.inventoryAddress);
  if (inventory === null) {
    problems.push({
      code: "wrong-inventory",
      message: `Not a kind:31633 inventory address: ${String(input.inventoryAddress)}`,
    });
    return finish();
  }

  if (headFoldId === undefined || isBlank(headFoldId)) {
    // No fold reference: the pre-spend / never-folded state. Nothing settled.
    return finish();
  }

  const foldsById = indexById(input.folds);
  const visited = new Set<string>();
  let nextId: string | undefined = headFoldId;
  while (nextId !== undefined) {
    if (visited.has(nextId)) {
      problems.push({
        code: "cycle",
        message: `Fold chain revisits manifest ${nextId}`,
        foldId: nextId,
      });
      break;
    }
    visited.add(nextId);

    const event = foldsById.get(nextId);
    if (event === undefined) {
      problems.push({
        code: "missing-fold",
        message: `Fold manifest ${nextId} is not among the supplied events`,
        foldId: nextId,
      });
      break;
    }
    const parsed = parseGameInventoryFoldResult(event, options);
    if (!parsed.ok) {
      problems.push({
        code: "invalid-fold",
        message: `Fold manifest ${nextId} is invalid: ${parsed.error}`,
        foldId: nextId,
      });
      break;
    }
    const fold = parsed.value;
    if (fold.inventoryAddress !== input.inventoryAddress) {
      problems.push({
        code: "wrong-inventory",
        message: `Fold manifest ${fold.id} is scoped to ${fold.inventoryAddress}, not ${input.inventoryAddress}`,
        foldId: fold.id,
      });
      break;
    }
    if (fold.owner !== inventory.pubkey) {
      // Unreachable when the address matched (the parser already ties author
      // to the address), kept as defence in depth.
      problems.push({
        code: "wrong-author",
        message: `Fold manifest ${fold.id} is authored by ${fold.owner}, not the inventory owner ${inventory.pubkey}`,
        foldId: fold.id,
      });
      break;
    }

    chain.push(fold);
    for (const id of fold.spendIds) {
      collect(id, fold.id, "spend");
    }
    for (const id of fold.voidIds) {
      collect(id, fold.id, "void");
    }
    nextId = fold.previous?.eventId;
  }

  if (problems.length === 0 && input.spends !== undefined) {
    verifySpends(input.spends);
  }

  return finish();

  function collect(id: string, foldId: string, kind: "spend" | "void"): void {
    const sameKind = kind === "spend" ? foldedBy : voidedBy;
    const otherKind = kind === "spend" ? voidedBy : foldedBy;
    const earlier = sameKind.get(id);
    if (earlier !== undefined) {
      warnings.push({
        code: "refolded-spend",
        message: `Spend ${id} is referenced as \`${kind}\` by both ${earlier} and ${foldId}`,
        foldId,
        spendId: id,
      });
      return;
    }
    const contradicting = otherKind.get(id);
    if (contradicting !== undefined) {
      warnings.push({
        code: "contradictory-spend",
        message: `Spend ${id} is referenced as \`${kind}\` by ${foldId} and as \`${kind === "spend" ? "void" : "spend"}\` by ${contradicting}`,
        foldId,
        spendId: id,
      });
      return;
    }
    sameKind.set(id, foldId);
    (kind === "spend" ? foldedSpendIds : voidedSpendIds).push(id);
  }

  function verifySpends(spends: readonly NostrEvent[]): void {
    const spendsById = indexById(spends);
    const references: [string, string][] = [
      ...foldedSpendIds.map((id): [string, string] => [
        id,
        foldedBy.get(id) as string,
      ]),
      ...voidedSpendIds.map((id): [string, string] => [
        id,
        voidedBy.get(id) as string,
      ]),
    ];
    for (const [spendId, foldId] of references) {
      const event = spendsById.get(spendId);
      if (event === undefined) {
        warnings.push({
          code: "unverified-spend",
          message: `Spend ${spendId} referenced by ${foldId} is not among the supplied spend events`,
          foldId,
          spendId,
        });
        continue;
      }
      const parsed = parseGameInventorySpendResult(event, options);
      if (!parsed.ok) {
        problems.push({
          code: "invalid-spend",
          message: `Fold manifest ${foldId} references an invalid spend ${spendId}: ${parsed.error}`,
          foldId,
          spendId,
        });
        continue;
      }
      if (parsed.value.inventoryAddress !== input.inventoryAddress) {
        problems.push({
          code: "foreign-spend",
          message: `Fold manifest ${foldId} references spend ${spendId}, which debits ${parsed.value.inventoryAddress}, not ${input.inventoryAddress}`,
          foldId,
          spendId,
        });
      }
    }
  }

  function finish(): GameInventoryFoldResolution {
    const resolution: GameInventoryFoldResolution = {
      status: problems.length === 0 ? "resolved" : "unresolved",
      chain,
      foldedSpendIds,
      voidedSpendIds,
      settledSpendIds: [...foldedSpendIds, ...voidedSpendIds],
      problems,
      warnings,
    };
    if (headFoldId !== undefined && !isBlank(headFoldId)) {
      resolution.headFoldId = headFoldId;
    }
    return resolution;
  }
}

/**
 * Index events by id, keeping the first copy of each (relay duplicates).
 */
function indexById(events: readonly NostrEvent[]): Map<string, NostrEvent> {
  const byId = new Map<string, NostrEvent>();
  for (const event of events) {
    const id = event.id;
    if (typeof id === "string" && !isBlank(id) && !byId.has(id)) {
      byId.set(id, event);
    }
  }
  return byId;
}
