"use client";

import { useCallback, useRef, useState } from "react";
import type { NormalizedLandmarkList } from "@mediapipe/pose";

import {
  frameElbowAngle,
  INITIAL_PUSHUP_STATE,
  type PushupPhase,
  type PushupState,
  stepPushupFsm,
} from "@/lib/judge/pushups";

type UsePushupDetectorArgs = {
  /** Solo cuenta mientras el duelo está en marcha. */
  enabled: boolean;
};

type UsePushupDetectorResult = {
  reps: number;
  phase: PushupPhase;
  /** Alimenta la máquina de estados con un fotograma de MediaPipe. */
  processFrame: (landmarks: NormalizedLandmarkList | undefined) => void;
  /** Lectura sin pasar por el estado de React, para el envío final. */
  getReps: () => number;
  /** Pone el contador a cero al arrancar un duelo. */
  reset: () => void;
};

/**
 * Contador de planchas.
 *
 * La FSM vive en un ref y se ejecuta a la velocidad de MediaPipe (~30 fps);
 * el estado de React solo se toca cuando la fase o el contador cambian de
 * verdad, que ocurre un par de veces por segundo. Publicar cada fotograma
 * provocaría 30 renders por segundo compitiendo con la inferencia.
 *
 * Toda la lógica de conteo está en lib/judge/pushups.ts, que es puro y tiene
 * sus propios tests. Aquí solo hay pegamento de React.
 */
export function usePushupDetector({
  enabled,
}: UsePushupDetectorArgs): UsePushupDetectorResult {
  const stateRef = useRef<PushupState>(INITIAL_PUSHUP_STATE);
  const [published, setPublished] = useState<PushupState>(INITIAL_PUSHUP_STATE);

  const processFrame = useCallback(
    (landmarks: NormalizedLandmarkList | undefined) => {
      if (!enabled) return;

      const current = stateRef.current;
      const step = stepPushupFsm(current, frameElbowAngle(landmarks));

      if (step.phase === current.phase && step.reps === current.reps) return;

      stateRef.current = { phase: step.phase, reps: step.reps };
      setPublished(stateRef.current);
    },
    [enabled],
  );

  const getReps = useCallback(() => stateRef.current.reps, []);

  const reset = useCallback(() => {
    stateRef.current = INITIAL_PUSHUP_STATE;
    setPublished(INITIAL_PUSHUP_STATE);
  }, []);

  return {
    reps: published.reps,
    phase: published.phase,
    processFrame,
    getReps,
    reset,
  };
}
