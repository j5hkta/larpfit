/**
 * Tipos de dominio de la fase de emparejamiento.
 *
 * TODO: sustituir por los tipos generados desde Supabase en cuanto tengamos el
 * project-id a mano:
 *   npx supabase gen types typescript --project-id <ref> > types/database.ts
 * Hasta entonces esto refleja a mano el esquema de 00001_initial_schema.sql.
 */

/** Las dos disciplinas. Debe coincidir con el CHECK de 00004_game_modes.sql. */
export type GameMode = "aesthetics" | "performance";

/** Nivel del modo Rendimiento. Null en Estética. Ver 00006_drafting_phase.sql. */
export type PerformanceTier = "normal" | "hard";

/**
 * Configuración elegida en el selector. Solo se empareja con quien haya
 * escogido exactamente lo mismo.
 */
export type MatchSetup = {
  gameMode: GameMode;
  performanceTier: PerformanceTier | null;
  isMystery: boolean;
};

export type MatchRow = {
  id: string;
  player1_id: string;
  player2_id: string;
  status: "active" | "completed";
  winner_id: string | null;
  player1_score: number | null;
  player2_score: number | null;
  game_mode: GameMode;
  performance_tier: PerformanceTier | null;
  is_mystery: boolean;
  /** Las tres cartas que repartió el servidor. */
  draft_options: string[] | null;
  p1_vote: string | null;
  p2_vote: string | null;
  selected_exercise: string | null;
  created_at: string;
};

export type ActiveMatch = {
  id: string;
  opponentId: string;
  opponentUsername: string | null;
  /** Disciplina del duelo, tal como quedó registrada en el servidor. */
  gameMode: GameMode;
  performanceTier: PerformanceTier | null;
  isMystery: boolean;
  /**
   * player1 es siempre quien crea la oferta SDP. Se decide por la fila del
   * match y no por quién llegue antes, para que ambos clientes coincidan.
   */
  isInitiator: boolean;
};

export type MatchmakingState =
  | { status: "connecting" }
  | { status: "searching" }
  | { status: "found"; match: ActiveMatch }
  | { status: "cancelled" }
  | { status: "error"; message: string };
