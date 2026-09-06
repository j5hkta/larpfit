"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { createClient } from "@/utils/supabase/client";
import type { MatchRow } from "@/types/match";

/** Red de seguridad si el UPDATE de Realtime no llega (ms). */
const POLL_INTERVAL_MS = 2000;

type DraftRow = Pick<
  MatchRow,
  | "id"
  | "player1_id"
  | "player2_id"
  | "draft_options"
  | "p1_vote"
  | "p2_vote"
  | "selected_exercise"
>;

const COLUMNS =
  "id, player1_id, player2_id, draft_options, p1_vote, p2_vote, selected_exercise";

export type DraftState = {
  /** Las tres cartas repartidas por el servidor. */
  options: string[];
  /** Lo que votó este jugador, si ya votó. */
  myVote: string | null;
  /** Lo que votó el rival. En misterioso no se enseña cuál es. */
  opponentVote: string | null;
  /** Ejercicio final. Null mientras falte algún voto. */
  selectedExercise: string | null;
  loading: boolean;
  error: string | null;
};

type UseMatchDraftResult = DraftState & {
  vote: (exercise: string) => Promise<void>;
};

/**
 * Estado compartido de la fase de selección.
 *
 * Escucha los UPDATE de la fila del match: cuando el rival vota, su elección
 * aparece aquí sin recargar. El sorteo final lo decide cast_vote() en el
 * servidor; este hook solo observa.
 */
export function useMatchDraft(
  matchId: string,
  userId: string,
): UseMatchDraftResult {
  const supabase = useMemo(() => createClient(), []);
  const [row, setRow] = useState<DraftRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;

    const absorb = (next: DraftRow) => {
      if (!disposed) setRow(next);
    };

    const fetchRow = async () => {
      const { data } = await supabase
        .from("matches")
        .select(COLUMNS)
        .eq("id", matchId)
        .single<DraftRow>();

      if (data) absorb(data);
    };

    const channel = supabase
      .channel(`match-draft:${matchId}`, {
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
        // Lectura inicial: el rival pudo votar antes de que nos suscribiéramos.
        await fetchRow();
      });

    // Respaldo: quedarse mirando unas cartas muertas sería el peor final.
    const interval = setInterval(() => void fetchRow(), POLL_INTERVAL_MS);

    return () => {
      disposed = true;
      clearInterval(interval);
      void supabase.removeChannel(channel);
      setRow(null);
    };
  }, [supabase, matchId]);

  const vote = useCallback(
    async (exercise: string) => {
      setError(null);

      const { error: rpcError } = await supabase.rpc("cast_vote", {
        p_match_id: matchId,
        p_exercise: exercise,
      });

      if (rpcError) {
        setError(`No pudimos registrar tu voto: ${rpcError.message}`);
      }
    },
    [supabase, matchId],
  );

  const isPlayer1 = row?.player1_id === userId;

  return {
    options: row?.draft_options ?? [],
    myVote: row ? (isPlayer1 ? row.p1_vote : row.p2_vote) : null,
    opponentVote: row ? (isPlayer1 ? row.p2_vote : row.p1_vote) : null,
    selectedExercise: row?.selected_exercise ?? null,
    loading: row === null,
    error,
    vote,
  };
}
