"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Radar, Swords, XCircle } from "lucide-react";

import { VideoRoom } from "@/components/VideoRoom";
import { useMatchmaking } from "@/hooks/useMatchmaking";
import { countryName } from "@/lib/countries";
import { gameModeInfo } from "@/lib/game-modes";
import type { GameMode } from "@/types/match";

/** Milisegundos que dejamos el cartel de "oponente encontrado" antes del duelo. */
const REVEAL_MS = 2200;

type MatchmakerProps = {
  userId: string;
  username: string;
  country: string;
  gameMode: GameMode;
  /** Vuelve al selector de disciplina. */
  onChangeMode: () => void;
};

export function Matchmaker({
  userId,
  username,
  country,
  gameMode,
  onChangeMode,
}: MatchmakerProps) {
  const { state, cancel, retry } = useMatchmaking(userId, country, gameMode);

  const [elapsed, setElapsed] = useState(0);
  const [enteredRoom, setEnteredRoom] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const searching = state.status === "searching";
  const region = countryName(country) ?? country;
  const mode = gameModeInfo(gameMode);

  // Cronómetro de búsqueda. El tiempo se deriva del instante de arranque, así
  // no hace falta tocar el estado en el cuerpo del efecto.
  useEffect(() => {
    if (!searching) return;

    const startedAt = Date.now();
    const interval = setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      250,
    );

    return () => clearInterval(interval);
  }, [searching]);

  // Pausa dramática entre "encontrado" y la sala de vídeo.
  useEffect(() => {
    if (state.status !== "found") return;

    const timeout = setTimeout(() => setEnteredRoom(true), REVEAL_MS);

    return () => {
      clearTimeout(timeout);
      setEnteredRoom(false);
    };
  }, [state.status]);

  const handleCancel = useCallback(async () => {
    setCancelling(true);
    await cancel();
    setCancelling(false);
  }, [cancel]);

  const handleRetry = useCallback(() => {
    setEnteredRoom(false);
    retry();
  }, [retry]);

  // --- Duelo en marcha -------------------------------------------------------
  if (state.status === "found" && enteredRoom) {
    return (
      <VideoRoom
        matchId={state.match.id}
        userId={userId}
        isInitiator={state.match.isInitiator}
        opponentUsername={state.match.opponentUsername}
        gameMode={state.match.gameMode}
        onLeave={handleRetry}
      />
    );
  }

  // --- Pantallas de estado ---------------------------------------------------
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-12 text-center">
      {state.status === "found" ? (
        <>
          <Swords aria-hidden className="mb-6 size-12 text-volt-400" />
          <h1 className="text-3xl font-black uppercase tracking-tight text-white sm:text-4xl">
            ¡Oponente encontrado!
          </h1>
          <p className="mt-4 text-lg text-arena-300">
            <span className="font-bold text-white">{username}</span>
            <span className="mx-3 text-volt-400">VS</span>
            <span className="font-bold text-white">
              {state.match.opponentUsername ?? "Rival"}
            </span>
          </p>
          <p className="mt-6 text-xs uppercase tracking-widest text-arena-500">
            Preparando la arena…
          </p>
        </>
      ) : state.status === "error" ? (
        <>
          <AlertCircle aria-hidden className="mb-6 size-10 text-flex-400" />
          <h1 className="text-2xl font-black uppercase tracking-tight text-white">
            Algo ha fallado
          </h1>
          <p className="mt-3 max-w-sm text-sm text-arena-300">
            {state.message}
          </p>
          <button
            type="button"
            onClick={handleRetry}
            className="mt-8 rounded-lg bg-volt-500 px-6 py-3 text-sm font-black uppercase tracking-widest text-arena-950 transition-colors hover:bg-volt-400"
          >
            Reintentar
          </button>
        </>
      ) : state.status === "cancelled" ? (
        <>
          <XCircle aria-hidden className="mb-6 size-10 text-arena-500" />
          <h1 className="text-2xl font-black uppercase tracking-tight text-white">
            Búsqueda cancelada
          </h1>
          <p className="mt-3 text-sm text-arena-300">
            Ya no estás en la cola de {mode.name} en {region}.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={handleRetry}
              className="rounded-lg bg-volt-500 px-6 py-3 text-sm font-black uppercase tracking-widest text-arena-950 transition-colors hover:bg-volt-400"
            >
              Buscar de nuevo
            </button>
            <button
              type="button"
              onClick={onChangeMode}
              className="rounded-lg border border-arena-700 px-6 py-3 text-xs font-semibold uppercase tracking-wider text-arena-300 transition-colors hover:border-volt-500/50 hover:text-white"
            >
              Cambiar de disciplina
            </button>
          </div>
        </>
      ) : (
        <>
          <Radar
            aria-hidden
            className="mb-6 size-12 animate-pulse text-volt-400"
          />
          <h1 className="text-2xl font-black uppercase tracking-tight text-white sm:text-3xl">
            {state.status === "connecting"
              ? "Conectando con la arena…"
              : "Buscando oponente…"}
          </h1>
          <p className="mt-3 text-sm text-arena-300">
            {mode.name} · Región{" "}
            <span className="font-semibold text-white">{region}</span>
          </p>

          {searching && (
            <p
              aria-live="polite"
              className="mt-6 font-mono text-3xl font-bold tabular-nums text-volt-400"
            >
              {String(Math.floor(elapsed / 60)).padStart(2, "0")}:
              {String(elapsed % 60).padStart(2, "0")}
            </p>
          )}

          <button
            type="button"
            onClick={handleCancel}
            disabled={cancelling || state.status === "connecting"}
            className="mt-10 rounded-lg border border-arena-700 px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-arena-300 transition-colors hover:border-flex-500/50 hover:text-flex-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cancelling ? "Cancelando…" : "Cancelar búsqueda"}
          </button>
        </>
      )}
    </div>
  );
}
