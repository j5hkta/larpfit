"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { NormalizedLandmarkList } from "@mediapipe/pose";

import { findExercise } from "@/lib/exercises";
import {
  createDetector,
  type DetectorWarning,
  type PhaseLabels,
  type RepPhase,
} from "@/lib/judge/detectors";

/**
 * Fotogramas seguidos con aviso antes de enseñarlo.
 *
 * Los landmarks parpadean: sin este colchón, el cartel de encuadre aparecería
 * y desaparecería varias veces por segundo. Se quita en cuanto el encuadre se
 * arregla, sin espera.
 */
const WARNING_GRACE_FRAMES = 10;

type UseModularDetectorArgs = {
  /** Ejercicio sorteado en el drafting. Null en Estética. */
  exerciseId: string | null;
  enabled: boolean;
};

type UseModularDetectorResult = {
  reps: number;
  phase: RepPhase;
  /** Etiquetas legibles de las dos fases de ESTE ejercicio. */
  labels: PhaseLabels;
  /** Aviso de encuadre, o null si se ve todo lo necesario. */
  warning: DetectorWarning;
  processFrame: (landmarks: NormalizedLandmarkList | undefined) => void;
  getReps: () => number;
  reset: () => void;
};

/**
 * Enruta los fotogramas al detector que corresponde al ejercicio.
 *
 * La FSM vive en un ref y corre a la velocidad de MediaPipe (~30 fps); el
 * estado de React solo se toca cuando algo cambia de verdad. Publicar cada
 * fotograma serían 30 renders por segundo compitiendo con la inferencia.
 */
export function useModularDetector({
  exerciseId,
  enabled,
}: UseModularDetectorArgs): UseModularDetectorResult {
  const family = findExercise(exerciseId)?.counter ?? "push";

  // Cambiar de ejercicio construye una máquina nueva y limpia.
  const detector = useMemo(() => createDetector(family), [family]);

  const [phase, setPhase] = useState<RepPhase>("rest");
  const [reps, setReps] = useState(0);
  const [warning, setWarning] = useState<DetectorWarning>(null);

  const warningStreak = useRef(0);
  const shownWarning = useRef<DetectorWarning>(null);

  /**
   * Espejo de lo último publicado a React.
   *
   * Se compara contra esto y no contra el estado anterior de la FSM: al
   * cambiar de ejercicio la máquina nueva arranca en 0, y si comparásemos
   * contra ella nunca publicaríamos ese 0 y el contador se quedaría con las
   * repeticiones del ejercicio anterior.
   */
  const publishedPhase = useRef<RepPhase>("rest");
  const publishedReps = useRef(0);

  const processFrame = useCallback(
    (landmarks: NormalizedLandmarkList | undefined) => {
      if (!enabled) return;

      const step = detector.processFrame(landmarks);

      if (step.phase !== publishedPhase.current) {
        publishedPhase.current = step.phase;
        setPhase(step.phase);
      }

      if (step.reps !== publishedReps.current) {
        publishedReps.current = step.reps;
        setReps(step.reps);
      }

      // Histéresis del aviso: aparecer cuesta, desaparecer es inmediato.
      if (step.warning === null) {
        warningStreak.current = 0;
        if (shownWarning.current !== null) {
          shownWarning.current = null;
          setWarning(null);
        }
        return;
      }

      warningStreak.current += 1;
      if (
        warningStreak.current >= WARNING_GRACE_FRAMES &&
        shownWarning.current !== step.warning
      ) {
        shownWarning.current = step.warning;
        setWarning(step.warning);
      }
    },
    [detector, enabled],
  );

  const getReps = useCallback(() => detector.snapshot().reps, [detector]);

  const reset = useCallback(() => {
    detector.reset();
    warningStreak.current = 0;
    shownWarning.current = null;
    publishedPhase.current = "rest";
    publishedReps.current = 0;
    setPhase("rest");
    setReps(0);
    setWarning(null);
  }, [detector]);

  return {
    reps,
    phase,
    labels: detector.labels,
    warning,
    processFrame,
    getReps,
    reset,
  };
}
