/**
 * Detector de cardio: jumping jacks.
 *
 * Aquí no hay ángulos que valgan. Se comparan posiciones: muñecas por encima
 * de los hombros y tobillos más separados que los hombros.
 */

import { MIN_VISIBILITY, type PosePoint } from "../vtaper.ts";
import {
  allVisible,
  createFsm,
  type DetectorState,
  type DetectorStep,
  type ExerciseFSM,
} from "./types.ts";

export const JACK_LANDMARKS = {
  leftShoulder: 11,
  rightShoulder: 12,
  leftWrist: 15,
  rightWrist: 16,
  leftAnkle: 27,
  rightAnkle: 28,
} as const;

const REQUIRED = Object.values(JACK_LANDMARKS);

/**
 * Histéresis sobre el ancho de hombros. Abrir exige superar el 110% y cerrar
 * bajar del 90%: entre medias no pasa nada. Sin esta banda, quedarse justo en
 * el umbral dispararía repeticiones en cadena.
 */
export const OPEN_ANKLE_RATIO = 1.1;
export const CLOSED_ANKLE_RATIO = 0.9;

export const JACK_WARNING = "Necesitamos verte de cuerpo entero";

type Posture = "open" | "closed" | "between";

/**
 * Clasifica la postura del fotograma.
 *
 * Ojo con el eje Y: en coordenadas de imagen crece hacia ABAJO, así que
 * "muñeca por encima del hombro" es `wrist.y < shoulder.y`.
 */
export function classifyPosture(
  landmarks: readonly PosePoint[] | undefined,
): Posture | null {
  if (!allVisible(landmarks, REQUIRED, MIN_VISIBILITY) || !landmarks) {
    return null;
  }

  const leftShoulder = landmarks[JACK_LANDMARKS.leftShoulder];
  const rightShoulder = landmarks[JACK_LANDMARKS.rightShoulder];
  const leftWrist = landmarks[JACK_LANDMARKS.leftWrist];
  const rightWrist = landmarks[JACK_LANDMARKS.rightWrist];
  const leftAnkle = landmarks[JACK_LANDMARKS.leftAnkle];
  const rightAnkle = landmarks[JACK_LANDMARKS.rightAnkle];

  const shoulderWidth = Math.abs(leftShoulder.x - rightShoulder.x);
  if (shoulderWidth <= 0.001) return null;

  const ankleSpread = Math.abs(leftAnkle.x - rightAnkle.x);
  const spreadRatio = ankleSpread / shoulderWidth;

  const wristsUp =
    leftWrist.y < leftShoulder.y && rightWrist.y < rightShoulder.y;
  const wristsDown =
    leftWrist.y > leftShoulder.y && rightWrist.y > rightShoulder.y;

  if (wristsUp && spreadRatio > OPEN_ANKLE_RATIO) return "open";
  if (wristsDown && spreadRatio < CLOSED_ANKLE_RATIO) return "closed";

  return "between";
}

/**
 * Transiciones:
 *   · postura abierta               → fase `active`
 *   · postura cerrada viniendo de   → fase `rest` y +1 repetición
 *     `active`
 */
export function stepJumpingJack(
  state: DetectorState,
  landmarks: readonly PosePoint[] | undefined,
): DetectorStep {
  const posture = classifyPosture(landmarks);

  if (posture === null) {
    return { ...state, counted: false, warning: JACK_WARNING };
  }

  if (posture === "open") {
    return { phase: "active", reps: state.reps, counted: false, warning: null };
  }

  if (posture === "closed" && state.phase === "active") {
    return {
      phase: "rest",
      reps: state.reps + 1,
      counted: true,
      warning: null,
    };
  }

  return { ...state, counted: false, warning: null };
}

export function createJumpingJackDetector(): ExerciseFSM {
  return createFsm(
    "jumping-jack",
    { rest: "Cerrado", active: "Abierto" },
    stepJumpingJack,
  );
}
