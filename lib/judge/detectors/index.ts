/**
 * Enrutador de detectores: del ejercicio sorteado a la máquina de estados que
 * sabe contarlo.
 */

import { createJumpingJackDetector } from "./jumping-jack.ts";
import { createPushDetector } from "./push.ts";
import { createSquatDetector } from "./squat.ts";
import type { ExerciseFSM } from "./types.ts";

export type DetectorFamily = "push" | "squat" | "jumping-jack";

export const DETECTOR_FAMILIES: readonly DetectorFamily[] = [
  "push",
  "squat",
  "jumping-jack",
] as const;

export function isDetectorFamily(value: string): value is DetectorFamily {
  return DETECTOR_FAMILIES.includes(value as DetectorFamily);
}

/**
 * Crea la FSM de una familia. Ante un valor desconocido cae en empuje, que es
 * el detector más maduro, en vez de dejar el duelo sin contador.
 */
export function createDetector(family: DetectorFamily | string): ExerciseFSM {
  switch (family) {
    case "squat":
      return createSquatDetector();
    case "jumping-jack":
      return createJumpingJackDetector();
    case "push":
    default:
      return createPushDetector();
  }
}

export * from "./types.ts";
export { createJumpingJackDetector, createPushDetector, createSquatDetector };
