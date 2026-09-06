"use client";

import { useState } from "react";
import { ChevronLeft, Dumbbell, HelpCircle, Timer, Trophy } from "lucide-react";

import { countryName } from "@/lib/countries";
import { tierDuration, tierLabel } from "@/lib/exercises";
import { GAME_MODES, type GameModeInfo } from "@/lib/game-modes";
import type { GameMode, MatchSetup, PerformanceTier } from "@/types/match";

/**
 * Elección de disciplina y, en Rendimiento, de nivel y modalidad.
 * Solo presentación: el estado del duelo vive en PlayArena.
 */

type ModeSelectProps = {
  username: string;
  country: string;
  onSelect: (setup: MatchSetup) => void;
};

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

/** Las cuatro variantes de Rendimiento. */
const PERFORMANCE_VARIANTS: readonly {
  tier: PerformanceTier;
  isMystery: boolean;
}[] = [
  { tier: "normal", isMystery: false },
  { tier: "hard", isMystery: false },
  { tier: "normal", isMystery: true },
  { tier: "hard", isMystery: true },
];

function ModeCard({
  mode,
  onPick,
}: {
  mode: GameModeInfo;
  onPick: (mode: GameMode) => void;
}) {
  const accent = ACCENT[mode.id];
  const Icon = mode.id === "aesthetics" ? Trophy : Dumbbell;

  return (
    <button
      type="button"
      onClick={() => onPick(mode.id)}
      className={`group relative flex flex-col items-start overflow-hidden rounded-2xl border border-arena-700/70 bg-arena-900/80 p-7 text-left transition-all duration-200 hover:-translate-y-1 hover:shadow-2xl hover:shadow-black/60 ${accent.ring}`}
    >
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
          {mode.id === "performance" ? "30-60s" : `${mode.durationSeconds}s`}
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
        className={`relative mt-6 text-sm font-black uppercase tracking-widest ${accent.text}`}
      >
        {mode.id === "performance" ? "Elegir nivel →" : "Entrar →"}
      </span>
    </button>
  );
}

function VariantCard({
  tier,
  isMystery,
  onSelect,
}: {
  tier: PerformanceTier;
  isMystery: boolean;
  onSelect: (setup: MatchSetup) => void;
}) {
  const hard = tier === "hard";

  return (
    <button
      type="button"
      onClick={() =>
        onSelect({
          gameMode: "performance",
          performanceTier: tier,
          isMystery,
        })
      }
      className={`group relative flex flex-col items-start overflow-hidden rounded-2xl border border-arena-700/70 bg-arena-900/80 p-6 text-left transition-all duration-200 hover:-translate-y-1 ${
        hard ? "hover:border-flex-500/70" : "hover:border-volt-500/70"
      }`}
    >
      <div className="flex w-full items-start justify-between gap-3">
        {isMystery ? (
          <HelpCircle aria-hidden className="size-7 text-arena-300" />
        ) : (
          <Dumbbell
            aria-hidden
            className={`size-7 ${hard ? "text-flex-400" : "text-volt-400"}`}
          />
        )}
        <span
          className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-wider ${
            hard
              ? "border-flex-500/40 bg-flex-500/10 text-flex-400"
              : "border-volt-500/40 bg-volt-500/10 text-volt-400"
          }`}
        >
          <Timer aria-hidden className="size-3.5" />
          {tierDuration(tier)}s
        </span>
      </div>

      <h3 className="mt-4 text-lg font-black uppercase tracking-tight text-white">
        {isMystery ? `Misterioso ${tierLabel(tier)}` : tierLabel(tier)}
      </h3>

      <p className="mt-2 text-sm leading-relaxed text-arena-300">
        {isMystery
          ? "Las tres cartas están tapadas. Eliges a ciegas y el ejercicio se revela al empezar."
          : hard
            ? "Burpees, flexiones diamante y compañía. Un minuto a fondo."
            : "Flexiones, sentadillas, jumping jacks. Medio minuto."}
      </p>
    </button>
  );
}

export function ModeSelect({ username, country, onSelect }: ModeSelectProps) {
  const [expanded, setExpanded] = useState(false);
  const region = countryName(country) ?? country;

  const handlePick = (mode: GameMode) => {
    if (mode === "performance") {
      setExpanded(true);
      return;
    }

    onSelect({
      gameMode: "aesthetics",
      performanceTier: null,
      isMystery: false,
    });
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-12">
      <header className="mb-10 text-center">
        <p className="text-xs uppercase tracking-widest text-arena-500">
          {username} · {region}
        </p>
        <h1 className="mt-2 text-3xl font-black uppercase tracking-tight text-white sm:text-4xl">
          {expanded ? "Elige el nivel" : "Elige tu disciplina"}
        </h1>
        <p className="mt-3 text-sm text-arena-300">
          {expanded
            ? "Solo te emparejamos con quien haya elegido exactamente lo mismo."
            : "Solo te emparejamos con gente de tu región que haya elegido lo mismo."}
        </p>
      </header>

      {expanded ? (
        <>
          <div className="grid w-full max-w-4xl gap-4 sm:grid-cols-2">
            {PERFORMANCE_VARIANTS.map((variant) => (
              <VariantCard
                key={`${variant.tier}-${variant.isMystery}`}
                tier={variant.tier}
                isMystery={variant.isMystery}
                onSelect={onSelect}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="mt-8 flex items-center gap-2 rounded-lg border border-arena-700 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-arena-300 transition-colors hover:border-volt-500/50 hover:text-white"
          >
            <ChevronLeft aria-hidden className="size-4" />
            Volver
          </button>
        </>
      ) : (
        <div className="grid w-full max-w-4xl gap-5 sm:grid-cols-2">
          {GAME_MODES.map((mode) => (
            <ModeCard key={mode.id} mode={mode} onPick={handlePick} />
          ))}
        </div>
      )}
    </div>
  );
}
