import { parseAddressableEventAddress } from "../../common/address.js";
import { isFiniteNumber } from "../../common/numbers.js";
import { cloneJsonLike, isPlainObject } from "../../common/objects.js";
import { isBlank } from "../../common/strings.js";
import { parseGameItemAddress } from "../game-item-definition/address.js";
import { KIND_GAME_ITEM_DEFINITION } from "../../common/constants.js";
import type {
  GameItemPlacementEntry,
  GameItemPlacementReference,
  GameItemPlacementTarget,
} from "./types.js";

/**
 * Structural validation for the kind:31634 `content` document.
 *
 * These validators are shared by the parser (which turns a failure into a
 * warning or a rejection depending on mode), the builder and the mutation
 * helpers (which throw). They are internal: consumers validate by parsing an
 * event or by building one.
 *
 * Two rules run through all of them:
 *
 * 1. **Nothing is coerced.** A numeric string is not a number, and `NaN`,
 *    `Infinity` and `-Infinity` are never accepted as coordinates.
 * 2. **Unknown data survives.** Validation only checks the fields this version
 *    defines; the returned value is a deep copy of the input, so unknown
 *    fields, unknown enum-like values and unknown nested structures are
 *    preserved exactly.
 */

export type ContentValidation<T> =
  { ok: true; value: T } | { ok: false; reason: string };

function invalid<T>(reason: string): ContentValidation<T> {
  return { ok: false, reason };
}

/** Options shared by the validators that resolve addresses. */
export interface PlacementValidationOptions {
  /**
   * Require item and target addresses to use canonical 64-char hex pubkeys.
   * Defaults to `false`, matching the rest of the package.
   */
  requireHexPubkey?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Target                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Validate `content.target`.
 *
 * A target with a `type` this version does not define is *accepted* and
 * preserved verbatim: rejecting it would make every client built against this
 * version reject documents written against a newer one. Only the known target
 * types have their shape enforced.
 */
export function validatePlacementTargetValue(
  value: unknown,
  options: PlacementValidationOptions = {},
): ContentValidation<GameItemPlacementTarget> {
  if (!isPlainObject(value)) {
    return invalid("`target` must be a JSON object");
  }

  const type = value["type"];
  if (typeof type !== "string" || isBlank(type)) {
    return invalid("`target.type` must be a non-empty string");
  }

  if (type === "address") {
    const address = value["address"];
    if (typeof address !== "string" || isBlank(address)) {
      return invalid("`target.address` must be a non-empty string");
    }
    if (
      parseAddressableEventAddress(address, {
        requireHexPubkey: options.requireHexPubkey ?? false,
      }) === null
    ) {
      return invalid(
        `\`target.address\` is not a valid addressable-event address: ${address}`,
      );
    }
    const relay = value["relay"];
    if (relay !== undefined && typeof relay !== "string") {
      return invalid("`target.relay` must be a string when present");
    }
  } else if (type === "internal") {
    const id = value["id"];
    if (typeof id !== "string" || isBlank(id)) {
      return invalid("`target.id` must be a non-empty string");
    }
  }

  return { ok: true, value: cloneJsonLike(value) as GameItemPlacementTarget };
}

/* -------------------------------------------------------------------------- */
/* Reference                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Validate `content.reference`.
 *
 * A reference whose `space` this version does not define is accepted and
 * preserved; only the recognized `2d` and `3d` structures have their required
 * fields enforced. Coordinates are never normalized and no defaults are
 * written into the parsed object — rendering defaults belong to consumers.
 */
export function validatePlacementReferenceValue(
  value: unknown,
): ContentValidation<GameItemPlacementReference> {
  if (!isPlainObject(value)) {
    return invalid("`reference` must be a JSON object");
  }

  const space = value["space"];
  if (typeof space !== "string" || isBlank(space)) {
    return invalid("`reference.space` must be a non-empty string");
  }

  if (space === "2d" || space === "3d") {
    const unit = value["unit"];
    if (typeof unit !== "string" || isBlank(unit)) {
      return invalid("`reference.unit` must be a non-empty string");
    }
    const origin = value["origin"];
    if (typeof origin !== "string" || isBlank(origin)) {
      return invalid("`reference.origin` must be a non-empty string");
    }
  }

  if (space === "2d") {
    if (!isFiniteNumber(value["width"])) {
      return invalid("`reference.width` must be a finite number");
    }
    if (!isFiniteNumber(value["height"])) {
      return invalid("`reference.height` must be a finite number");
    }
  }

  if (space === "3d") {
    const handedness = value["handedness"];
    if (
      handedness !== undefined &&
      (typeof handedness !== "string" || isBlank(handedness))
    ) {
      return invalid(
        "`reference.handedness` must be a non-empty string when present",
      );
    }
    const upAxis = value["upAxis"];
    if (
      upAxis !== undefined &&
      (typeof upAxis !== "string" || isBlank(upAxis))
    ) {
      return invalid(
        "`reference.upAxis` must be a non-empty string when present",
      );
    }
  }

  return {
    ok: true,
    value: cloneJsonLike(value) as GameItemPlacementReference,
  };
}

/**
 * `true` when the reference is a recognized 3D coordinate system, which makes
 * a `z` position component mandatory for every entry.
 */
export function referenceRequiresZ(
  reference: GameItemPlacementReference | undefined,
): boolean {
  return reference !== undefined && reference.space === "3d";
}

/* -------------------------------------------------------------------------- */
/* Placement entries                                                          */
/* -------------------------------------------------------------------------- */

export interface PlacementEntryValidationOptions extends PlacementValidationOptions {
  /**
   * Require a `z` component on every `position`. Set when the document
   * declares a recognized 3D reference.
   */
  requireZ?: boolean;
}

/**
 * Validate a single `content.placements[]` entry.
 *
 * `id`, `item` and `mode` are required; `item` must be a well-formed
 * kind:31632 coordinate. Unknown modes and unknown slots are valid. This never
 * checks ownership, issuer trust, slot compatibility or authorization — those
 * are application policy.
 */
export function validatePlacementEntryValue(
  value: unknown,
  options: PlacementEntryValidationOptions = {},
): ContentValidation<GameItemPlacementEntry> {
  if (!isPlainObject(value)) {
    return invalid("placement entry must be a JSON object");
  }

  const id = value["id"];
  if (typeof id !== "string" || isBlank(id)) {
    return invalid("`id` must be a non-empty string");
  }

  const item = value["item"];
  if (typeof item !== "string" || isBlank(item)) {
    return invalid("`item` must be a non-empty string");
  }
  if (
    parseGameItemAddress(item, {
      requireHexPubkey: options.requireHexPubkey ?? false,
    }) === null
  ) {
    return invalid(
      `\`item\` must be a valid kind:${KIND_GAME_ITEM_DEFINITION} address: ${item}`,
    );
  }

  const mode = value["mode"];
  if (typeof mode !== "string" || isBlank(mode)) {
    return invalid("`mode` must be a non-empty string");
  }

  for (const field of ["slot", "form", "view"] as const) {
    const fieldValue = value[field];
    if (
      fieldValue !== undefined &&
      (typeof fieldValue !== "string" || isBlank(fieldValue))
    ) {
      return invalid(`\`${field}\` must be a non-empty string when present`);
    }
  }

  const layer = value["layer"];
  if (layer !== undefined && !isFiniteNumber(layer)) {
    return invalid("`layer` must be a finite number when present");
  }

  const positionIssue = validatePosition(
    value["position"],
    options.requireZ ?? false,
  );
  if (positionIssue !== null) {
    return invalid(positionIssue);
  }

  const rotationIssue = validateRotation(value["rotation"]);
  if (rotationIssue !== null) {
    return invalid(rotationIssue);
  }

  const scaleIssue = validateScale(value["scale"]);
  if (scaleIssue !== null) {
    return invalid(scaleIssue);
  }

  const flipIssue = validateFlip(value["flip"]);
  if (flipIssue !== null) {
    return invalid(flipIssue);
  }

  return { ok: true, value: cloneJsonLike(value) as GameItemPlacementEntry };
}

/** Returns an issue message, or `null` when the value is absent or valid. */
function validatePosition(value: unknown, requireZ: boolean): string | null {
  if (value === undefined) {
    return null;
  }
  if (!isPlainObject(value)) {
    return "`position` must be a JSON object";
  }
  if (!isFiniteNumber(value["x"]) || !isFiniteNumber(value["y"])) {
    return "`position.x` and `position.y` must be finite numbers";
  }
  const z = value["z"];
  if (z !== undefined && !isFiniteNumber(z)) {
    return "`position.z` must be a finite number when present";
  }
  if (requireZ && z === undefined) {
    return "`position.z` is required because the document declares a 3d reference";
  }
  return null;
}

function validateRotation(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }
  if (!isPlainObject(value)) {
    return "`rotation` must be a JSON object";
  }

  const type = value["type"];
  if (typeof type !== "string" || isBlank(type)) {
    return "`rotation.type` must be a non-empty string";
  }

  if (type === "euler") {
    const unit = value["unit"];
    if (typeof unit !== "string" || isBlank(unit)) {
      return "`rotation.unit` must be a non-empty string";
    }
    const order = value["order"];
    if (order !== undefined && (typeof order !== "string" || isBlank(order))) {
      return "`rotation.order` must be a non-empty string when present";
    }
    // Every component is optional: a 2D placement legitimately carries `z`
    // alone. Provided components must still be finite.
    for (const axis of ["x", "y", "z"] as const) {
      const component = value[axis];
      if (component !== undefined && !isFiniteNumber(component)) {
        return `\`rotation.${axis}\` must be a finite number when present`;
      }
    }
    return null;
  }

  if (type === "quaternion") {
    for (const axis of ["x", "y", "z", "w"] as const) {
      if (!isFiniteNumber(value[axis])) {
        return `\`rotation.${axis}\` must be a finite number`;
      }
    }
    if (
      value["x"] === 0 &&
      value["y"] === 0 &&
      value["z"] === 0 &&
      value["w"] === 0
    ) {
      // A zero-length quaternion describes no rotation at all. It is rejected
      // rather than normalized: this library never rewrites transforms.
      return "`rotation` is a zero-length quaternion";
    }
    return null;
  }

  // Unknown rotation type: preserved verbatim for forward compatibility.
  return null;
}

function validateScale(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }
  if (!isPlainObject(value)) {
    return "`scale` must be a JSON object";
  }
  if (!isFiniteNumber(value["x"]) || !isFiniteNumber(value["y"])) {
    return "`scale.x` and `scale.y` must be finite numbers";
  }
  const z = value["z"];
  if (z !== undefined && !isFiniteNumber(z)) {
    return "`scale.z` must be a finite number when present";
  }
  return null;
}

function validateFlip(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }
  if (!isPlainObject(value)) {
    return "`flip` must be a JSON object";
  }
  if (typeof value["x"] !== "boolean" || typeof value["y"] !== "boolean") {
    return "`flip.x` and `flip.y` must be booleans";
  }
  return null;
}
