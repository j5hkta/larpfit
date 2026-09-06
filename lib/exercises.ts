import type { PerformanceTier } from "@/types/match";

/**
 * Catálogo de ejercicios del modo Rendimiento.
 *
 * REPARTO DE CARTAS: las tres cartas de cada duelo las elige el SERVIDOR y
 * quedan guardadas en `matches.draft_options`. Si cada cliente sorteara las
 * suyas, los dos jugadores verían cartas distintas: votar por "la misma" sería
 * imposible y el indicador de "tu rival votó aquí" apuntaría a una carta que el
 * otro no tiene delante.
 *
 * Este archivo es la fuente de la PRESENTACIÓN (nombre, descripción, duración).
 * La lista de ids debe mantenerse en paralelo con la de 00006_drafting_phase.sql.
 */

import type { DetectorFamily } from "@/lib/judge/detectors";

export type Exercise = {
  id: string;
  name: string;
  description: string;
  tier: PerformanceTier;
  durationSeconds: number;
  /**
   * Qué máquina de estados lo cuenta.
   *
   * Exactos: los de empuje con 'push', los de pierna con 'squat' y los
   * jumping jacks con 'jumping-jack'.
   *
   * APROXIMADOS: burpees, escaladores, caminatas a plancha, rodillas al pecho
   * y saltos con rodillas se asignan a la familia más cercana. Cuentan algo
   * razonable, pero no son detectores dedicados.
   */
  counter: DetectorFamily;
};

/** Normal: 30 segundos. */
const NORMAL_SECONDS = 30;
/** Difícil: 60 segundos. */
const HARD_SECONDS = 60;

export const EXERCISES: readonly Exercise[] = [
  // --- Normal ---------------------------------------------------------------
  {
    id: "pushups",
    name: "Flexiones",
    description: "Pecho al suelo, brazos estirados arriba.",
    tier: "normal",
    durationSeconds: NORMAL_SECONDS,
    counter: "push",
  },
  {
    id: "squats",
    name: "Sentadillas",
    description: "Cadera por debajo de la rodilla en cada repetición.",
    tier: "normal",
    durationSeconds: NORMAL_SECONDS,
    counter: "squat",
  },
  {
    id: "jumping_jacks",
    name: "Jumping Jacks",
    description: "Brazos arriba y piernas abiertas, a ritmo.",
    tier: "normal",
    durationSeconds: NORMAL_SECONDS,
    counter: "jumping-jack",
  },
  {
    id: "high_knees",
    name: "Rodillas al pecho",
    description: "Rodillas por encima de la cadera, sin bajar el ritmo.",
    tier: "normal",
    durationSeconds: NORMAL_SECONDS,
    counter: "squat",
  },
  {
    id: "lunges",
    name: "Zancadas",
    description: "Alterna piernas, rodilla trasera cerca del suelo.",
    tier: "normal",
    durationSeconds: NORMAL_SECONDS,
    counter: "squat",
  },
  {
    id: "mountain_climbers",
    name: "Escaladores",
    description: "En plancha, rodillas al pecho alternando.",
    tier: "normal",
    durationSeconds: NORMAL_SECONDS,
    counter: "squat",
  },

  // --- Difícil --------------------------------------------------------------
  {
    id: "burpees",
    name: "Burpees",
    description: "Al suelo, flexión y salto. Completo o no cuenta.",
    tier: "hard",
    durationSeconds: HARD_SECONDS,
    counter: "push",
  },
  {
    id: "diamond_pushups",
    name: "Flexiones diamante",
    description: "Manos juntas bajo el pecho. Tríceps al límite.",
    tier: "hard",
    durationSeconds: HARD_SECONDS,
    counter: "push",
  },
  {
    id: "knee_jumps",
    name: "Saltos con rodillas",
    description: "Salta y lleva las rodillas al pecho en el aire.",
    tier: "hard",
    durationSeconds: HARD_SECONDS,
    counter: "squat",
  },
  {
    id: "pike_pushups",
    name: "Flexiones pike",
    description: "Cadera arriba, cabeza al suelo. Hombro puro.",
    tier: "hard",
    durationSeconds: HARD_SECONDS,
    counter: "push",
  },
  {
    id: "jump_squats",
    name: "Sentadillas con salto",
    description: "Baja del todo y despega en cada repetición.",
    tier: "hard",
    durationSeconds: HARD_SECONDS,
    counter: "squat",
  },
  {
    id: "plank_walkouts",
    name: "Caminatas a plancha",
    description: "De pie a plancha caminando con las manos, y vuelta.",
    tier: "hard",
    durationSeconds: HARD_SECONDS,
    counter: "push",
  },
] as const;

/** Cuántas cartas se reparten por duelo. */
export const DRAFT_SIZE = 3;

export function exercisesByTier(tier: PerformanceTier): Exercise[] {
  return EXERCISES.filter((exercise) => exercise.tier === tier);
}

export function findExercise(id: string | null | undefined): Exercise | null {
  if (!id) return null;
  return EXERCISES.find((exercise) => exercise.id === id) ?? null;
}

/**
 * Duración del duelo para un ejercicio. Si el id no está en el catálogo (la
 * base de datos va por delante del cliente) se cae al valor del nivel.
 */
export function exerciseDuration(
  id: string | null | undefined,
  tier: PerformanceTier,
): number {
  return (
    findExercise(id)?.durationSeconds ??
    (tier === "hard" ? HARD_SECONDS : NORMAL_SECONDS)
  );
}

export function tierLabel(tier: PerformanceTier): string {
  return tier === "hard" ? "Difícil" : "Normal";
}

export function tierDuration(tier: PerformanceTier): number {
  return tier === "hard" ? HARD_SECONDS : NORMAL_SECONDS;
}
