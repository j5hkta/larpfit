"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Check,
  HelpCircle,
  Loader2,
  Swords,
  Timer,
} from "lucide-react";

import { useMatchDraft } from "@/hooks/useMatchDraft";
import { exerciseDuration, findExercise } from "@/lib/exercises";
import type { PerformanceTier } from "@/types/match";

/** Duración de la ruleta final antes de entrar a la arena. */
const ROULETTE_MS = 3000;
/** Cada cuánto cambia la carta resaltada durante la ruleta. */
const ROULETTE_TICK_MS = 110;

type DraftingPhaseProps = {
  matchId: string;
  userId: string;
  performanceTier: PerformanceTier;
  isMystery: boolean;
  opponentUsername: string | null;
  /** Se llama con el ejercicio final cuando termina la ruleta. */
  onReady: (exerciseId: string) => void;
  onLeave: () => void;
};

function CardFace({
  exerciseId,
  isMystery,
  revealed,
}: {
  exerciseId: string;
  isMystery: boolean;
  revealed: boolean;
}) {
  const exercise = findExercise(exerciseId);

  // Carta misteriosa: interrogación opaca hasta que se resuelve el duelo.
  if (isMystery && !revealed) {
    return (
      <>
        <HelpCircle aria-hidden className="size-12 text-arena-500" />
        <p className="mt-4 text-xl font-black uppercase tracking-tight text-arena-300">
          ¿?
        </p>
        <p className="mt-2 text-xs text-arena-500">
          Carta oculta. Vota a ciegas.
        </p>
      </>
    );
  }

  return (
    <>
      <Swords aria-hidden className="size-8 text-volt-400" />
      <p className="mt-4 text-lg font-black uppercase tracking-tight text-white">
        {exercise?.name ?? exerciseId}
      </p>
      <p className="mt-2 text-xs leading-relaxed text-arena-300">
        {exercise?.description ?? "Ejercicio sorpresa."}
      </p>
    </>
  );
}

export function DraftingPhase({
  matchId,
  userId,
  performanceTier,
  isMystery,
  opponentUsername,
  onReady,
  onLeave,
}: DraftingPhaseProps) {
  const {
    options,
    myVote,
    opponentVote,
    selectedExercise,
    loading,
    error,
    vote,
  } = useMatchDraft(matchId, userId);

  const [rouletteIndex, setRouletteIndex] = useState<number | null>(null);
  const [voting, setVoting] = useState(false);

  const handleVote = useCallback(
    async (exerciseId: string) => {
      if (myVote || selectedExercise) return;
      setVoting(true);
      await vote(exerciseId);
      setVoting(false);
    },
    [myVote, selectedExercise, vote],
  );

  // Ruleta: se enciende cuando el servidor ya decidió el ejercicio.
  useEffect(() => {
    if (!selectedExercise || options.length === 0) return;

    const spin = setInterval(() => {
      setRouletteIndex((index) =>
        index === null ? 0 : (index + 1) % options.length,
      );
    }, ROULETTE_TICK_MS);

    const finish = setTimeout(() => {
      clearInterval(spin);
      onReady(selectedExercise);
    }, ROULETTE_MS);

    return () => {
      clearInterval(spin);
      clearTimeout(finish);
    };
  }, [selectedExercise, options.length, onReady]);

  const spinning = selectedExercise !== null;
  const duration = exerciseDuration(selectedExercise, performanceTier);

  if (loading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-12 text-center">
        <Loader2 aria-hidden className="size-8 animate-spin text-volt-400" />
        <p className="text-sm text-arena-300">Repartiendo cartas…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-10 text-center">
      <header className="mb-8">
        <p className="text-xs uppercase tracking-widest text-arena-500">
          Selección · vs {opponentUsername ?? "Rival"}
        </p>
        <h1 className="mt-2 text-3xl font-black uppercase tracking-tight text-white sm:text-4xl">
          {spinning ? "Decidiendo…" : "Elige tu carta"}
        </h1>
        <p className="mt-3 max-w-md text-sm text-arena-300">
          {spinning
            ? "La suerte está echada."
            : isMystery
              ? "Las cartas están ocultas. Votad a ciegas: si coincidís, sale esa; si no, el servidor sortea."
              : "Si los dos votáis lo mismo, sale esa. Si no, el servidor sortea entre las dos elegidas."}
        </p>
      </header>

      <div className="grid w-full max-w-4xl gap-4 sm:grid-cols-3">
        {options.map((exerciseId, index) => {
          const isMine = myVote === exerciseId;
          const isOpponents = opponentVote === exerciseId;
          const isWinner = selectedExercise === exerciseId;
          const isHighlighted = spinning && rouletteIndex === index;

          return (
            <button
              key={exerciseId}
              type="button"
              disabled={Boolean(myVote) || spinning || voting}
              onClick={() => void handleVote(exerciseId)}
              className={`relative flex flex-col items-center rounded-2xl border p-6 text-center transition-all duration-150 disabled:cursor-not-allowed ${
                isWinner && !isHighlighted && rouletteIndex !== null
                  ? "scale-105 border-volt-500 bg-volt-500/15"
                  : isHighlighted
                    ? "scale-105 border-volt-400 bg-volt-500/20"
                    : isMine
                      ? "border-volt-500/70 bg-volt-500/10"
                      : "border-arena-700/70 bg-arena-900/80 enabled:hover:-translate-y-1 enabled:hover:border-volt-500/60"
              }`}
            >
              {/* Indicadores de voto */}
              <div className="absolute right-3 top-3 flex gap-1.5">
                {isMine && (
                  <span
                    title="Tu voto"
                    className="flex items-center gap-1 rounded-full border border-volt-500/50 bg-volt-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-volt-400"
                  >
                    <Check aria-hidden className="size-3" />
                    Tú
                  </span>
                )}
                {isOpponents && (
                  <span
                    title="Tu rival votó aquí"
                    className="flex items-center gap-1 rounded-full border border-flex-500/50 bg-flex-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-flex-400"
                  >
                    <Check aria-hidden className="size-3" />
                    Rival
                  </span>
                )}
              </div>

              <CardFace
                exerciseId={exerciseId}
                isMystery={isMystery}
                revealed={spinning}
              />
            </button>
          );
        })}
      </div>

      {/* Estado de la votación */}
      <div className="mt-8 flex min-h-[3.5rem] flex-col items-center gap-2">
        {error && (
          <p
            role="alert"
            className="flex items-center gap-2 text-sm text-flex-400"
          >
            <AlertCircle aria-hidden className="size-4" />
            {error}
          </p>
        )}

        {spinning ? (
          <p
            aria-live="polite"
            className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-volt-400"
          >
            <Timer aria-hidden className="size-4" />
            {findExercise(selectedExercise)?.name ?? selectedExercise} ·{" "}
            {duration}s
          </p>
        ) : myVote ? (
          <p
            aria-live="polite"
            className="flex items-center gap-2 text-sm text-arena-300"
          >
            <Loader2 aria-hidden className="size-4 animate-spin" />
            Voto registrado. Esperando a {opponentUsername ?? "tu rival"}…
          </p>
        ) : (
          <p className="text-xs uppercase tracking-widest text-arena-500">
            {opponentVote && !isMystery
              ? "Tu rival ya ha votado"
              : opponentVote
                ? "Tu rival ya ha votado (carta oculta)"
                : "Nadie ha votado todavía"}
          </p>
        )}
      </div>

      {!spinning && (
        <button
          type="button"
          onClick={onLeave}
          className="mt-6 rounded-lg border border-arena-700 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-arena-300 transition-colors hover:border-flex-500/50 hover:text-flex-400"
        >
          Abandonar duelo
        </button>
      )}
    </div>
  );
}
