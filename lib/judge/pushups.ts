/**
 * El juez de rendimiento: máquina de estados finitos que cuenta planchas.
 *
 * Lógica pura y testeable, separada del hook de React y de MediaPipe.
 */

import { calculateAngle, type Point2D } from "./angles.ts";
import { MIN_VISIBILITY, type PosePoint } from "./vtaper.ts";

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

export type PushupPhase = "up" | "down";

export type PushupState = {
  phase: PushupPhase;
  reps: number;
};

export const INITIAL_PUSHUP_STATE: PushupState = { phase: "up", reps: 0 };

export type PushupStep = PushupState & {
  /** true solo en el fotograma exacto en que se suma una repetición. */
  counted: boolean;
};

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
  const points: Point2D[] = [];

  for (const index of [shoulder, elbow, wrist]) {
    const point = landmarks[index];
    if (!point || (point.visibility ?? 0) < MIN_VISIBILITY) return null;
    points.push(point);
  }

  return calculateAngle(points[0], points[1], points[2]);
}

/**
 * Ángulo de codo representativo del fotograma.
 *
 * Si se ven los dos brazos se promedian: en una plancha real ambos codos hacen
 * lo mismo, y promediar amortigua el ruido de los landmarks. Si solo hay uno
 * fiable, vale ese. Si no hay ninguno, el fotograma se descarta.
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
 * Avanza la máquina de estados con el ángulo de un fotograma.
 *
 * Transiciones:
 *   · ángulo < 90°               → phase 'down'
 *   · ángulo > 160° y venía de   → phase 'up' y reps += 1
 *     'down'
 *
 * Entre 90° y 160° no pasa nada: esa banda muerta es lo que impide que un
 * temblor alrededor del umbral dispare repeticiones en cadena.
 *
 * Un ángulo null (fotograma dudoso) deja el estado intacto.
 */
export function stepPushupFsm(
  state: PushupState,
  angle: number | null,
): PushupStep {
  if (angle === null) return { ...state, counted: false };

  if (angle < DOWN_ANGLE) {
    return { phase: "down", reps: state.reps, counted: false };
  }

  if (angle > UP_ANGLE && state.phase === "down") {
    return { phase: "up", reps: state.reps + 1, counted: true };
  }

  return { ...state, counted: false };
}
