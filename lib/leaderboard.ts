import type { GameMode } from "@/types/match";

/**
 * Clasificación global: tipos y formato. Lógica pura, sin React ni Supabase.
 */

export type LeaderboardEntry = {
  rank: number;
  username: string;
  score: number;
};

/** Cuántos puestos pide la portada. */
export const LEADERBOARD_SIZE = 10;

/**
 * Formatea una puntuación según la disciplina.
 *
 * Rendimiento acumula repeticiones (enteros); Estética guarda un ratio
 * hombros/cintura, que sin decimales sería indistinguible entre jugadores.
 */
export function formatScore(
  score: number | null | undefined,
  mode: GameMode,
): string {
  if (score === null || score === undefined || !Number.isFinite(score)) {
    return "—";
  }

  return mode === "performance"
    ? Math.round(score).toLocaleString("es-ES")
    : score.toFixed(2);
}

export type MedalTier = "gold" | "silver" | "bronze";

/** Metal del podio, o null fuera del top 3. */
export function medalTier(rank: number): MedalTier | null {
  switch (rank) {
    case 1:
      return "gold";
    case 2:
      return "silver";
    case 3:
      return "bronze";
    default:
      return null;
  }
}

/**
 * Normaliza lo que devuelve la RPC.
 *
 * PostgREST puede serializar `numeric` como cadena, así que la puntuación se
 * fuerza a número. Las filas que no cuadren se descartan en vez de pintar
 * "NaN" en la portada.
 */
export function normalizeEntries(rows: unknown): LeaderboardEntry[] {
  if (!Array.isArray(rows)) return [];

  const entries: LeaderboardEntry[] = [];

  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;

    const candidate = row as Record<string, unknown>;
    const username =
      typeof candidate.username === "string" ? candidate.username.trim() : "";
    const score = Number(candidate.score);
    const rank = Number(candidate.rank);

    if (!username || !Number.isFinite(score) || !Number.isFinite(rank)) {
      continue;
    }

    entries.push({ rank, username, score });
  }

  return entries;
}
