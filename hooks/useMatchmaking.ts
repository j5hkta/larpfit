"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { createClient } from "@/utils/supabase/client";
import type { MatchRow, MatchSetup, MatchmakingState } from "@/types/match";

/** Red de seguridad por si Realtime no entrega el INSERT (ms). */
const POLL_INTERVAL_MS = 4000;

/**
 * Latido de la cola. Desde 00002 el servidor barre las filas con más de 30 s
 * sin refrescar, así que un cliente vivo TIENE que avisar de que sigue ahí o
 * lo echarán de la cola sin haber jugado.
 */
const HEARTBEAT_MS = 10000;

type UseMatchmakingResult = {
  state: MatchmakingState;
  cancel: () => Promise<void>;
  retry: () => void;
};

/**
 * Encola al usuario y resuelve el emparejamiento.
 *
 * El orden importa: primero nos suscribimos a Realtime y SOLO cuando el canal
 * confirma que está escuchando llamamos a la RPC. Si lo hiciéramos al revés,
 * un rival podría emparejarnos en el hueco entre ambas cosas y el INSERT nunca
 * nos llegaría: nos quedaríamos "buscando" para siempre con un match ya creado.
 */
export function useMatchmaking(
  userId: string,
  country: string,
  setup: MatchSetup,
): UseMatchmakingResult {
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState<MatchmakingState>({
    status: "connecting",
  });
  const [attempt, setAttempt] = useState(0);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const resolvedRef = useRef(false);

  /**
   * Carga la fila del match y averigua quién es el rival.
   * Es idempotente: Realtime y el polling pueden dispararla a la vez.
   */
  const resolveMatch = useCallback(
    async (matchId: string) => {
      if (resolvedRef.current) return;
      resolvedRef.current = true;

      const { data: match, error } = await supabase
        .from("matches")
        .select(
          "id, player1_id, player2_id, game_mode, performance_tier, is_mystery",
        )
        .eq("id", matchId)
        .single<
          Pick<
            MatchRow,
            | "id"
            | "player1_id"
            | "player2_id"
            | "game_mode"
            | "performance_tier"
            | "is_mystery"
          >
        >();

      if (error || !match) {
        resolvedRef.current = false;
        setState({
          status: "error",
          message: "Encontramos un rival pero no pudimos cargar el duelo.",
        });
        return;
      }

      const isInitiator = match.player1_id === userId;
      const opponentId = isInitiator ? match.player2_id : match.player1_id;

      const { data: opponent } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", opponentId)
        .single<{ username: string }>();

      // Ya no necesitamos escuchar: cerramos el canal antes de entrar al duelo.
      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }

      setState({
        status: "found",
        match: {
          id: match.id,
          opponentId,
          opponentUsername: opponent?.username ?? null,
          // El modo lo dicta la fila del match, no lo que eligió este cliente:
          // así ambos jugadores coinciden aunque uno tenga la UI desfasada.
          gameMode: match.game_mode,
          performanceTier: match.performance_tier,
          isMystery: match.is_mystery,
          isInitiator,
        },
      });
    },
    [supabase, userId],
  );

  // --- Suscripción + entrada en cola ----------------------------------------
  useEffect(() => {
    let cancelled = false;
    resolvedRef.current = false;

    // `postgres_changes_options.wait` retiene el SUBSCRIBED hasta que el
    // servidor confirma que la réplica está escuchando de verdad. Sin esto,
    // SUBSCRIBED puede llegar antes de que la suscripción exista y perderíamos
    // el INSERT del match.
    const channel = supabase.channel(`matchmaking:${userId}`, {
      config: { postgres_changes_options: { wait: true } },
    });
    channelRef.current = channel;

    const handleInsert = (payload: { new: MatchRow }) => {
      const row = payload.new;
      if (row.player1_id === userId || row.player2_id === userId) {
        void resolveMatch(row.id);
      }
    };

    // postgres_changes no admite OR, así que escuchamos las dos columnas.
    channel
      .on<MatchRow>(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "matches",
          filter: `player1_id=eq.${userId}`,
        },
        handleInsert,
      )
      .on<MatchRow>(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "matches",
          filter: `player2_id=eq.${userId}`,
        },
        handleInsert,
      )
      .subscribe(async (status) => {
        if (cancelled) return;

        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setState({
            status: "error",
            message:
              "No pudimos conectar con el servidor de emparejamiento. Revisa tu conexión.",
          });
          return;
        }

        if (status !== "SUBSCRIBED") return;

        setState({ status: "searching" });

        const { data, error } = await supabase.rpc("join_queue_or_match", {
          p_country: country,
          p_game_mode: setup.gameMode,
          p_performance_tier: setup.performanceTier,
          p_is_mystery: setup.isMystery,
        });

        if (cancelled) return;

        if (error) {
          setState({
            status: "error",
            message: `No pudimos entrar a la cola: ${error.message}`,
          });
          return;
        }

        // La RPC devuelve el match_id si había rival esperando, o null si nos
        // ha dejado en la cola (entonces esperamos al evento de Realtime).
        if (typeof data === "string") {
          void resolveMatch(data);
        }
      });

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [supabase, userId, country, setup, attempt, resolveMatch]);

  // --- Red de seguridad: sondeo mientras buscamos ---------------------------
  // Si Realtime falla (réplica caída, publicación mal configurada, red del
  // usuario), esto evita el peor fallo posible: quedarse buscando con un match
  // ya creado en la base de datos. Se puede quitar si Realtime demuestra ser
  // fiable en producción.
  useEffect(() => {
    if (state.status !== "searching") return;

    const interval = setInterval(async () => {
      const { data } = await supabase
        .from("matches")
        .select("id")
        .eq("status", "active")
        .or(`player1_id.eq.${userId},player2_id.eq.${userId}`)
        .limit(1)
        .maybeSingle<{ id: string }>();

      if (data?.id) void resolveMatch(data.id);
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [state.status, supabase, userId, resolveMatch]);

  // --- Latido mientras esperamos en la cola ---------------------------------
  useEffect(() => {
    if (state.status !== "searching") return;

    const interval = setInterval(() => {
      void supabase.rpc("heartbeat_queue");
    }, HEARTBEAT_MS);

    return () => clearInterval(interval);
  }, [state.status, supabase]);

  // --- Cancelar -------------------------------------------------------------
  const cancel = useCallback(async () => {
    if (channelRef.current) {
      void supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const { error } = await supabase.rpc("leave_queue");

    setState(
      error
        ? {
            status: "error",
            message: `No pudimos sacarte de la cola: ${error.message}`,
          }
        : { status: "cancelled" },
    );
  }, [supabase]);

  const retry = useCallback(() => {
    resolvedRef.current = false;
    // El estado se reinicia aquí, no en el efecto: React 19 prohíbe setState
    // síncrono en el cuerpo de un useEffect (provoca renders en cascada).
    setState({ status: "connecting" });
    setAttempt((value) => value + 1);
  }, []);

  return { state, cancel, retry };
}
