/**
 * Detector de pierna: sentadillas, zancadas y variantes con salto.
 *
 * Mide el ángulo cadera–rodilla–tobillo.
 */

import { calculateAngle } from "../angles.ts";
import { MIN_VISIBILITY, type PosePoint } from "../vtaper.ts";
import {
  allVisible,
  createFsm,
  type DetectorState,
  type DetectorStep,
  type ExerciseFSM,
} from "./types.ts";

/** Rodilla por debajo de este ángulo: ha bajado de verdad. */
export const DOWN_ANGLE = 100;

/** Rodilla por encima de este ángulo: pierna estirada, repetición completa. */
export const UP_ANGLE = 160;

export const LEG_LANDMARKS = {
  left: { hip: 23, knee: 25, ankle: 27 },
  right: { hip: 24, knee: 26, ankle: 28 },
} as const;

export type LegSide = keyof typeof LEG_LANDMARKS;

/**
 * El fallo de encuadre más común con sentadillas: la gente se pone demasiado
 * cerca y la cámara le corta por la cintura.
 */
export const SQUAT_WARNING = "Apunta la cámara a tus piernas";

export function legKneeAngle(
  landmarks: readonly PosePoint[] | undefined,
  side: LegSide,
): number | null {
  if (!landmarks) return null;

  const { hip, knee, ankle } = LEG_LANDMARKS[side];
  if (!allVisible(landmarks, [hip, knee, ankle], MIN_VISIBILITY)) return null;

  return calculateAngle(landmarks[hip], landmarks[knee], landmarks[ankle]);
}

/** Promedia las dos piernas visibles; en zancadas suele verse solo una. */
export function frameKneeAngle(
  landmarks: readonly PosePoint[] | undefined,
): number | null {
  const angles = (["left", "right"] as const)
    .map((side) => legKneeAngle(landmarks, side))
    .filter((angle): angle is number => angle !== null);

  if (angles.length === 0) return null;

  return angles.reduce((total, angle) => total + angle, 0) / angles.length;
}

/** ¿Se ve al menos un tobillo? Sin tobillos no hay ángulo de rodilla posible. */
export function anklesVisible(
  landmarks: readonly PosePoint[] | undefined,
): boolean {
  return (
    allVisible(landmarks, [LEG_LANDMARKS.left.ankle], MIN_VISIBILITY) ||
    allVisible(landmarks, [LEG_LANDMARKS.right.ankle], MIN_VISIBILITY)
  );
}

export function stepSquat(
  state: DetectorState,
  landmarks: readonly PosePoint[] | undefined,
): DetectorStep {
  const angle = frameKneeAngle(landmarks);

  if (angle === null) {
    // Distinguimos el caso concreto: es el aviso más accionable para el usuario.
    return {
      ...state,
      counted: false,
      warning: anklesVisible(landmarks)
        ? "Enfoca caderas, rodillas y tobillos"
        : SQUAT_WARNING,
    };
  }

  if (angle < DOWN_ANGLE) {
    return { phase: "active", reps: state.reps, counted: false, warning: null };
  }

  if (angle > UP_ANGLE && state.phase === "active") {
    return {
      phase: "rest",
      reps: state.reps + 1,
      counted: true,
      warning: null,
    };
  }

  return { ...state, counted: false, warning: null };
}

export function createSquatDetector(): ExerciseFSM {
  return createFsm("squat", { rest: "Arriba", active: "Abajo" }, stepSquat);
}
