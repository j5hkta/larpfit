/**
 * Detector de empuje: flexiones, diamante, pike.
 *
 * Mide el ángulo hombro–codo–muñeca. Es la lógica que estaba en
 * lib/judge/pushups.ts, movida aquí sin cambios de comportamiento.
 */

import { calculateAngle, type Point2D } from "../angles.ts";
import { MIN_VISIBILITY, type PosePoint } from "../vtaper.ts";
import {
  allVisible,
  createFsm,
  type DetectorState,
  type DetectorStep,
  type ExerciseFSM,
} from "./types.ts";

/** Codo por debajo de este ángulo: el pecho ha bajado. */
export const DOWN_ANGLE = 90;

/** Codo por encima de este ángulo: brazo estirado, repetición completa. */
export const UP_ANGLE = 160;

/** Índices de MediaPipe para cada brazo. */
export const ARM_LANDMARKS = {
  left: { shoulder: 11, elbow: 13, wrist: 15 },
  right: { shoulder: 12, elbow: 14, wrist: 16 },
} as const;

export type ArmSide = keyof typeof ARM_LANDMARKS;

export const PUSH_WARNING = "Enfoca hombros, codos y muñecas";

/**
 * Ángulo del codo de un brazo, o null si alguno de los tres puntos no llega al
 * umbral de confianza. No inventamos posiciones: un fotograma dudoso se ignora.
 */
export function armElbowAngle(
  landmarks: readonly PosePoint[] | undefined,
  side: ArmSide,
): number | null {
  if (!landmarks) return null;

  const { shoulder, elbow, wrist } = ARM_LANDMARKS[side];
  if (!allVisible(landmarks, [shoulder, elbow, wrist], MIN_VISIBILITY)) {
    return null;
  }

  const points: Point2D[] = [
    landmarks[shoulder],
    landmarks[elbow],
    landmarks[wrist],
  ];

  return calculateAngle(points[0], points[1], points[2]);
}

/**
 * Ángulo de codo representativo del fotograma.
 *
 * Si se ven los dos brazos se promedian: en una flexión real ambos codos hacen
 * lo mismo, y promediar amortigua el ruido de los landmarks.
 */
export function frameElbowAngle(
  landmarks: readonly PosePoint[] | undefined,
): number | null {
  const angles = (["left", "right"] as const)
    .map((side) => armElbowAngle(landmarks, side))
    .filter((angle): angle is number => angle !== null);

  if (angles.length === 0) return null;

  return angles.reduce((total, angle) => total + angle, 0) / angles.length;
}

/**
 * Transiciones:
 *   · ángulo < 90°              → fase `active`
 *   · ángulo > 160° viniendo de → fase `rest` y +1 repetición
 *     `active`
 *
 * La banda muerta entre 90° y 160° es lo que impide que un temblor alrededor
 * del umbral dispare repeticiones en cadena.
 */
export function stepPush(
  state: DetectorState,
  landmarks: readonly PosePoint[] | undefined,
): DetectorStep {
  const angle = frameElbowAngle(landmarks);

  if (angle === null) {
    return { ...state, counted: false, warning: PUSH_WARNING };
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

export function createPushDetector(): ExerciseFSM {
  return createFsm("push", { rest: "Arriba", active: "Abajo" }, stepPush);
}
