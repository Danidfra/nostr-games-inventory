import {
  GAME_ITEM_PLACEMENT_MODES,
  type GameItemPlacement2DReference,
  type GameItemPlacement3DReference,
  type GameItemPlacementAddressTarget,
  type GameItemPlacementEulerRotation,
  type GameItemPlacementInternalTarget,
  type GameItemPlacementMode,
  type GameItemPlacementQuaternionRotation,
  type GameItemPlacementReference,
  type GameItemPlacementRotation,
  type GameItemPlacementTarget,
} from "./types.js";

/**
 * Type guards for the open unions in the kind:31634 model.
 *
 * Each union has a member that carries an unknown discriminator so
 * forward-compatible data is preserved rather than rejected. These guards are
 * how a consumer narrows to the shapes this version understands, and they are
 * the intended way to decide whether a renderer can interpret a value at all.
 *
 * They are purely structural: a guard returning `true` means the value was
 * produced with a discriminator this version defines, and — for values that
 * came out of a parser or builder — that its required fields were validated.
 */

/** Narrow an arbitrary mode string to the modes defined by this version. */
export function isGameItemPlacementMode(
  value: unknown,
): value is GameItemPlacementMode {
  return (
    typeof value === "string" &&
    (GAME_ITEM_PLACEMENT_MODES as readonly string[]).includes(value)
  );
}

/** `true` when the target references another addressable event. */
export function isAddressPlacementTarget(
  target: GameItemPlacementTarget,
): target is GameItemPlacementAddressTarget {
  return target.type === "address";
}

/** `true` when the target is internal to the publishing application. */
export function isInternalPlacementTarget(
  target: GameItemPlacementTarget,
): target is GameItemPlacementInternalTarget {
  return target.type === "internal";
}

/** `true` when the reference declares the 2D coordinate system. */
export function isGameItemPlacement2DReference(
  reference: GameItemPlacementReference,
): reference is GameItemPlacement2DReference {
  return reference.space === "2d";
}

/** `true` when the reference declares the 3D coordinate system. */
export function isGameItemPlacement3DReference(
  reference: GameItemPlacementReference,
): reference is GameItemPlacement3DReference {
  return reference.space === "3d";
}

/** `true` when the rotation is a Euler rotation. */
export function isGameItemPlacementEulerRotation(
  rotation: GameItemPlacementRotation,
): rotation is GameItemPlacementEulerRotation {
  return rotation.type === "euler";
}

/** `true` when the rotation is a quaternion rotation. */
export function isGameItemPlacementQuaternionRotation(
  rotation: GameItemPlacementRotation,
): rotation is GameItemPlacementQuaternionRotation {
  return rotation.type === "quaternion";
}
