"use client";

import { useEffect, useMemo, useState } from "react";

import { createClient } from "@/utils/supabase/client";
import type { MatchRow } from "@/types/match";

/** Red de seguridad si el UPDATE de Realtime no llega (ms). */
const POLL_INTERVAL_MS = 3000;

type OutcomeRow = Pick<
  MatchRow,
  | "id"
  | "status"
  | "winner_id"
  | "player1_id"
  | "player2_id"
  | "player1_score"
  | "player2_score"
>;

const COLUMNS =
  "id, status, winner_id, player1_id, player2_id, player1_score, player2_score";

export type MatchOutcome = {
  resolved: boolean;
  /** null con veredicto resuelto significa empate exacto. */
  winnerId: string | null;
  myScore: number | null;
  opponentScore: number | null;
};

/**
 * Escucha la resolución del duelo.
 *
 * El veredicto lo escribe submit_score() en el servidor, así que el cliente
 * solo observa: no hay forma de que un jugador se declare ganador desde aquí.
 */
export function useMatchOutcome(
  matchId: string,
  userId: string,
  enabled: boolean,
): MatchOutcome | null {
  const supabase = useMemo(() => createClient(), []);
  const [row, setRow] = useState<OutcomeRow | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let disposed = false;

    const absorb = (next: OutcomeRow) => {
      if (!disposed) setRow(next);
    };

    const channel = supabase
      .channel(`match-outcome:${matchId}`, {
        config: { postgres_changes_options: { wait: true } },
      })
      .on<MatchRow>(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "matches",
          filter: `id=eq.${matchId}`,
        },
        (payload) => absorb(payload.new),
      )
      .subscribe(async (status) => {
        if (disposed || status !== "SUBSCRIBED") return;

        // Lectura inicial: el veredicto pudo resolverse antes de suscribirnos.
        const { data } = await supabase
          .from("matches")
          .select(COLUMNS)
          .eq("id", matchId)
          .single<OutcomeRow>();

        if (data) absorb(data);
      });

    // Respaldo por si Realtime no entrega el UPDATE: quedarse en "calculando
    // resultados" para siempre sería el peor final posible del duelo.
    const interval = setInterval(async () => {
      const { data } = await supabase
        .from("matches")
        .select(COLUMNS)
        .eq("id", matchId)
        .single<OutcomeRow>();

      if (data) absorb(data);
    }, POLL_INTERVAL_MS);

    return () => {
      disposed = true;
      clearInterval(interval);
      void supabase.removeChannel(channel);
      setRow(null);
    };
  }, [supabase, matchId, enabled]);

  if (!row) return null;

  const isPlayer1 = row.player1_id === userId;

  return {
    resolved: row.status === "completed",
    winnerId: row.winner_id,
    myScore: isPlayer1 ? row.player1_score : row.player2_score,
    opponentScore: isPlayer1 ? row.player2_score : row.player1_score,
  };
}
