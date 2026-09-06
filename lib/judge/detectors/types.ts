import type { PosePoint } from "../vtaper.ts";

/**
 * Contrato común de los detectores de ejercicio.
 *
 * Cada familia de movimiento mide articulaciones distintas, pero todas
 * comparten la misma forma: dos fases y un contador.
 */

/**
 * Fases normalizadas.
 *
 * `rest` es la posición de inicio y fin de la repetición (brazos estirados en
 * una flexión, de pie en una sentadilla, piernas juntas en un jumping jack).
 * `active` es el otro extremo. La repetición se cuenta al volver a `rest`, que
 * es lo que garantiza que el movimiento se completó.
 *
 * Cada detector aporta sus etiquetas legibles: "abajo/arriba" no significa lo
 * mismo que "abierto/cerrado".
 */
export type RepPhase = "rest" | "active";

export type DetectorState = {
  phase: RepPhase;
  reps: number;
};

export const INITIAL_DETECTOR_STATE: DetectorState = {
  phase: "rest",
  reps: 0,
};

/** Qué le falta ver a la cámara. Null si el encuadre es correcto. */
export type DetectorWarning = string | null;

export type DetectorStep = DetectorState & {
  /** true solo en el fotograma exacto en que se suma una repetición. */
  counted: boolean;
  warning: DetectorWarning;
};

export type PhaseLabels = {
  rest: string;
  active: string;
};

/**
 * Reductor puro. Mismo estado y mismos landmarks producen siempre el mismo
 * resultado, que es lo que permite probarlos sin cámara ni navegador.
 */
export type DetectorStepFn = (
  state: DetectorState,
  landmarks: readonly PosePoint[] | undefined,
) => DetectorStep;

export type ExerciseFSM = {
  readonly family: string;
  readonly labels: PhaseLabels;
  processFrame(landmarks: readonly PosePoint[] | undefined): DetectorStep;
  snapshot(): DetectorState;
  reset(): void;
};

/**
 * Envuelve un reductor puro en la máquina de estados con memoria que consume
 * el hook. Así la lógica sigue siendo testeable y no se repite el andamiaje.
 */
export function createFsm(
  family: string,
  labels: PhaseLabels,
  step: DetectorStepFn,
): ExerciseFSM {
  let state: DetectorState = INITIAL_DETECTOR_STATE;

  return {
    family,
    labels,
    processFrame(landmarks) {
      const result = step(state, landmarks);
      state = { phase: result.phase, reps: result.reps };
      return result;
    },
    snapshot() {
      return state;
    },
    reset() {
      state = INITIAL_DETECTOR_STATE;
    },
  };
}

/** Un punto solo cuenta si el modelo está razonablemente seguro de dónde está. */
export function allVisible(
  landmarks: readonly PosePoint[] | undefined,
  indices: readonly number[],
  minVisibility: number,
): boolean {
  if (!landmarks) return false;

  return indices.every((index) => {
    const point = landmarks[index];
    return Boolean(point) && (point.visibility ?? 0) >= minVisibility;
  });
}
