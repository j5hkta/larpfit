/**
 * El juez: lógica pura del V-taper.
 *
 * Sin React, sin DOM, sin MediaPipe. claude.md §5 lo exige así para poder
 * probarla de forma aislada del código de cámara y de render.
 */

/**
 * Índices de MediaPipe Pose que nos interesan.
 * @see https://google.github.io/mediapipe/solutions/pose
 */
export const LANDMARK = {
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
} as const;

/** Confianza mínima por punto para dar la medición por buena. */
export const MIN_VISIBILITY = 0.6;

/**
 * Rango plausible del V-taper. Fuera de esto la lectura es basura (torso de
 * lado, medio cuerpo fuera de cuadro, detección de algo que no es una persona)
 * y se descarta en vez de contaminar la puntuación.
 */
export const MIN_RATIO = 0.5;
export const MAX_RATIO = 3;

/** Muestras mínimas para que la mediana sea representativa. */
export const MIN_SAMPLES = 5;

/** Forma mínima de un landmark de MediaPipe. */
export type PosePoint = {
  x: number;
  y: number;
  visibility?: number;
};

export type TorsoReading = {
  /** Anchura de hombros normalizada (0-1 respecto al ancho del frame). */
  shoulderWidth: number;
  /** Anchura de cintura/caderas normalizada. */
  waistWidth: number;
  /** V-taper: hombros / cintura. Cuanto más alto, mejor. */
  ratio: number;
};

export function isVisible(
  landmarks: readonly PosePoint[],
  index: number,
): boolean {
  const point = landmarks[index];
  return Boolean(point) && (point.visibility ?? 0) >= MIN_VISIBILITY;
}

/** Una lectura solo cuenta si cae dentro del rango plausible. */
export function isPlausibleRatio(ratio: number): boolean {
  return Number.isFinite(ratio) && ratio >= MIN_RATIO && ratio <= MAX_RATIO;
}

/**
 * Mide el torso: distancia horizontal entre hombros (11-12) dividida por la
 * distancia entre caderas (23-24). Devuelve null si algún punto no es fiable.
 */
export function measureTorso(
  landmarks: readonly PosePoint[] | undefined,
): TorsoReading | null {
  if (!landmarks || landmarks.length === 0) return null;

  const required = [
    LANDMARK.LEFT_SHOULDER,
    LANDMARK.RIGHT_SHOULDER,
    LANDMARK.LEFT_HIP,
    LANDMARK.RIGHT_HIP,
  ];

  if (!required.every((index) => isVisible(landmarks, index))) return null;

  const shoulderWidth = Math.abs(
    landmarks[LANDMARK.LEFT_SHOULDER].x - landmarks[LANDMARK.RIGHT_SHOULDER].x,
  );
  const waistWidth = Math.abs(
    landmarks[LANDMARK.LEFT_HIP].x - landmarks[LANDMARK.RIGHT_HIP].x,
  );

  // Caderas pegadas: la división explotaría o daría un número absurdo.
  if (waistWidth <= 0.001) return null;

  return { shoulderWidth, waistWidth, ratio: shoulderWidth / waistWidth };
}

/** Mediana. Aguanta los picos raros mucho mejor que la media. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

/**
 * Puntuación final del jugador.
 *
 * claude.md §5: agregación de las muestras del duelo, nunca un único frame
 * afortunado. Si apenas hubo detección, cae en la última lectura válida antes
 * que devolver nada.
 */
export function aggregateScore(
  samples: readonly number[],
  lastRatio: number | null,
): number | null {
  if (samples.length >= MIN_SAMPLES) return median(samples);
  return lastRatio;
}
