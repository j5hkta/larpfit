/**
 * Agrupación del esqueleto de MediaPipe para el render tipo escáner.
 *
 * Lógica pura y sin DOM: decide en qué zona cae cada conexión para poder
 * pintarlas con estilos distintos. La lista de conexiones no se duplica aquí;
 * la publica el propio pose.js en `window.POSE_CONNECTIONS`.
 */

/** Landmarks 0-10: nariz, ojos, orejas y boca. */
export const FACE_MAX_INDEX = 10;

/** Conexiones que forman el tronco. Se pintan tenues porque encima van los
 *  resaltados de hombros y caderas, que es lo que evalúa el juez. */
export const TORSO_PAIRS: ReadonlySet<string> = new Set([
  "11-12",
  "11-23",
  "12-24",
  "23-24",
]);

export type ConnectionGroup = "face" | "limb" | "torso";

export const GROUP_STYLE: Record<
  ConnectionGroup,
  { alpha: number; width: number }
> = {
  face: { alpha: 0.45, width: 1.2 },
  limb: { alpha: 0.85, width: 2.2 },
  torso: { alpha: 0.35, width: 1.8 },
};

export function connectionKey(a: number, b: number): string {
  return `${Math.min(a, b)}-${Math.max(a, b)}`;
}

export function classifyConnection(a: number, b: number): ConnectionGroup {
  if (a <= FACE_MAX_INDEX && b <= FACE_MAX_INDEX) return "face";
  if (TORSO_PAIRS.has(connectionKey(a, b))) return "torso";
  return "limb";
}
