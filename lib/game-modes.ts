import type { GameMode } from "@/types/match";

/**
 * Metadatos de las disciplinas. Fuente única: las tarjetas de selección, los
 * textos de la arena y la duración del duelo leen todos de aquí.
 *
 * Los `id` deben coincidir con el CHECK de 00004_game_modes.sql.
 */

export type GameModeInfo = {
  id: GameMode;
  name: string;
  tagline: string;
  description: string;
  /** Duración del duelo en segundos. */
  durationSeconds: number;
  /** Qué mide el juez en esta disciplina. */
  metric: string;
};

export const GAME_MODES: readonly GameModeInfo[] = [
  {
    id: "aesthetics",
    name: "Batalla de Estética",
    tagline: "Flexea tu V-Taper",
    description:
      "Quince segundos para enseñar espalda y cintura. La IA mide la proporción de tu torso y decide.",
    durationSeconds: 15,
    metric: "V-Taper (hombros / cintura)",
  },
  {
    id: "performance",
    name: "Batalla de Rendimiento",
    tagline: "Máximas planchas",
    description:
      "Treinta segundos a fondo. Gana quien aguante más repeticiones con la forma correcta.",
    durationSeconds: 30,
    metric: "Repeticiones válidas",
  },
] as const;

export function isGameMode(value: string): value is GameMode {
  return GAME_MODES.some((mode) => mode.id === value);
}

export function gameModeInfo(id: GameMode): GameModeInfo {
  const found = GAME_MODES.find((mode) => mode.id === id);
  if (!found) throw new Error(`Modo de juego desconocido: ${id}`);
  return found;
}

export function gameModeName(id: GameMode): string {
  return gameModeInfo(id).name;
}
