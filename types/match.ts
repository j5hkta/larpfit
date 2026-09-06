/**
 * Tipos de dominio de la fase de emparejamiento.
 *
 * TODO: sustituir por los tipos generados desde Supabase en cuanto tengamos el
 * project-id a mano:
 *   npx supabase gen types typescript --project-id <ref> > types/database.ts
 * Hasta entonces esto refleja a mano el esquema de 00001_initial_schema.sql.
 */

export type MatchRow = {
  id: string;
  player1_id: string;
  player2_id: string;
  status: "active" | "completed";
  winner_id: string | null;
  player1_score: number | null;
  player2_score: number | null;
  created_at: string;
};

export type ActiveMatch = {
  id: string;
  opponentId: string;
  opponentUsername: string | null;
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
