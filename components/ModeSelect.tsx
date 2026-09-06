"use client";

import { Dumbbell, Timer, Trophy } from "lucide-react";

import { GAME_MODES, type GameModeInfo } from "@/lib/game-modes";
import { countryName } from "@/lib/countries";
import type { GameMode } from "@/types/match";

/**
 * Elección de disciplina. Solo presentación: el estado vive en PlayArena.
 */

type ModeSelectProps = {
  username: string;
  country: string;
  onSelect: (mode: GameMode) => void;
};

/** Acento por disciplina: volt para estética, magenta para rendimiento. */
const ACCENT: Record<
  GameMode,
  { ring: string; text: string; chip: string; glow: string }
> = {
  aesthetics: {
    ring: "hover:border-volt-500/70 focus-visible:border-volt-500/70",
    text: "text-volt-400",
    chip: "border-volt-500/40 bg-volt-500/10 text-volt-400",
    glow: "group-hover:bg-volt-500/10",
  },
  performance: {
    ring: "hover:border-flex-500/70 focus-visible:border-flex-500/70",
    text: "text-flex-400",
    chip: "border-flex-500/40 bg-flex-500/10 text-flex-400",
    glow: "group-hover:bg-flex-500/10",
  },
};

function ModeCard({
  mode,
  onSelect,
}: {
  mode: GameModeInfo;
  onSelect: (mode: GameMode) => void;
}) {
  const accent = ACCENT[mode.id];
  const Icon = mode.id === "aesthetics" ? Trophy : Dumbbell;

  return (
    <button
      type="button"
      onClick={() => onSelect(mode.id)}
      className={`group relative flex flex-col items-start overflow-hidden rounded-2xl border border-arena-700/70 bg-arena-900/80 p-7 text-left transition-all duration-200 hover:-translate-y-1 hover:shadow-2xl hover:shadow-black/60 ${accent.ring}`}
    >
      {/* Resplandor que crece al pasar por encima */}
      <span
        aria-hidden
        className={`pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-transparent blur-3xl transition-colors duration-300 ${accent.glow}`}
      />

      <div className="relative flex w-full items-start justify-between gap-4">
        <Icon aria-hidden className={`size-9 ${accent.text}`} />
        <span
          className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-wider ${accent.chip}`}
        >
          <Timer aria-hidden className="size-3.5" />
          {mode.durationSeconds}s
        </span>
      </div>

      <h2 className="relative mt-5 text-2xl font-black uppercase tracking-tight text-white">
        {mode.name}
      </h2>

      <p
        className={`relative mt-1 text-sm font-bold uppercase tracking-widest ${accent.text}`}
      >
        {mode.tagline}
      </p>

      <p className="relative mt-4 text-sm leading-relaxed text-arena-300">
        {mode.description}
      </p>

      <p className="relative mt-5 text-xs uppercase tracking-widest text-arena-500">
        Juez: {mode.metric}
      </p>

      <span
        className={`relative mt-6 text-sm font-black uppercase tracking-widest transition-colors ${accent.text}`}
      >
        Entrar →
      </span>
    </button>
  );
}

export function ModeSelect({ username, country, onSelect }: ModeSelectProps) {
  const region = countryName(country) ?? country;

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-12">
      <header className="mb-10 text-center">
        <p className="text-xs uppercase tracking-widest text-arena-500">
          {username} · {region}
        </p>
        <h1 className="mt-2 text-3xl font-black uppercase tracking-tight text-white sm:text-4xl">
          Elige tu disciplina
        </h1>
        <p className="mt-3 text-sm text-arena-300">
          Solo te emparejamos con gente de tu región que haya elegido lo mismo.
        </p>
      </header>

      <div className="grid w-full max-w-4xl gap-5 sm:grid-cols-2">
        {GAME_MODES.map((mode) => (
          <ModeCard key={mode.id} mode={mode} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}
