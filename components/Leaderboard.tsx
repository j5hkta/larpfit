"use client";

import { useState } from "react";
import { Crown, Dumbbell, Medal, Trophy } from "lucide-react";

import {
  formatScore,
  type LeaderboardEntry,
  medalTier,
  type MedalTier,
} from "@/lib/leaderboard";
import type { GameMode } from "@/types/match";

type LeaderboardProps = {
  aesthetics: LeaderboardEntry[];
  performance: LeaderboardEntry[];
};

const TABS: readonly { mode: GameMode; label: string; short: string }[] = [
  { mode: "aesthetics", label: "Reyes de la Estética", short: "Estética" },
  {
    mode: "performance",
    label: "Máquinas de Rendimiento",
    short: "Rendimiento",
  },
];

/** Podio en paleta cibernética: nada de dorados de trofeo de plástico. */
const MEDAL_STYLE: Record<
  MedalTier,
  { row: string; badge: string; text: string }
> = {
  gold: {
    row: "border-volt-500/50 bg-gradient-to-r from-volt-500/20 via-volt-500/5 to-transparent",
    badge: "bg-volt-500 text-arena-950",
    text: "text-volt-400",
  },
  silver: {
    row: "border-arena-300/40 bg-gradient-to-r from-arena-300/15 via-arena-300/5 to-transparent",
    badge: "bg-arena-300 text-arena-950",
    text: "text-arena-300",
  },
  bronze: {
    row: "border-flex-500/40 bg-gradient-to-r from-flex-500/15 via-flex-500/5 to-transparent",
    badge: "bg-flex-500 text-white",
    text: "text-flex-400",
  },
};

function Row({ entry, mode }: { entry: LeaderboardEntry; mode: GameMode }) {
  const tier = medalTier(entry.rank);
  const style = tier ? MEDAL_STYLE[tier] : null;

  return (
    <li
      className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
        style?.row ?? "border-arena-700/50 bg-arena-950/40"
      }`}
    >
      <span
        className={`flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-black tabular-nums ${
          style?.badge ?? "bg-arena-800 text-arena-300"
        }`}
      >
        {entry.rank}
      </span>

      {tier === "gold" ? (
        <Crown aria-hidden className="size-4 shrink-0 text-volt-400" />
      ) : tier ? (
        <Medal aria-hidden className={`size-4 shrink-0 ${style?.text}`} />
      ) : null}

      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white">
        {entry.username}
      </span>

      <span
        className={`shrink-0 font-mono text-sm font-bold tabular-nums ${
          style?.text ?? "text-arena-300"
        }`}
      >
        {formatScore(entry.score, mode)}
      </span>
    </li>
  );
}

export function Leaderboard({ aesthetics, performance }: LeaderboardProps) {
  const [active, setActive] = useState<GameMode>("aesthetics");

  const entries = active === "aesthetics" ? aesthetics : performance;
  const unit = active === "aesthetics" ? "V-Taper" : "Repeticiones";

  return (
    <section
      aria-label="Clasificación global"
      className="w-full max-w-md rounded-2xl border border-arena-700/70 bg-arena-900/80 p-5 shadow-2xl shadow-black/50 backdrop-blur"
    >
      <div
        role="tablist"
        aria-label="Clasificación"
        className="mb-4 grid grid-cols-2 gap-1 rounded-xl border border-arena-700/70 bg-arena-950 p-1"
      >
        {TABS.map((tab) => {
          const selected = active === tab.mode;
          const Icon = tab.mode === "aesthetics" ? Trophy : Dumbbell;

          return (
            <button
              key={tab.mode}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActive(tab.mode)}
              title={tab.label}
              className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-wider transition-colors ${
                selected
                  ? tab.mode === "aesthetics"
                    ? "bg-volt-500 text-arena-950"
                    : "bg-flex-500 text-white"
                  : "text-arena-300 hover:text-white"
              }`}
            >
              <Icon aria-hidden className="size-3.5" />
              {tab.short}
            </button>
          );
        })}
      </div>

      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-black uppercase tracking-tight text-white">
          {TABS.find((tab) => tab.mode === active)?.label}
        </h2>
        <span className="text-[10px] uppercase tracking-widest text-arena-500">
          {unit}
        </span>
      </div>

      {entries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-arena-700/70 px-4 py-8 text-center text-sm text-arena-500">
          Todavía no hay nadie en la tabla.
          <br />
          <span className="text-arena-300">Sé el primero.</span>
        </p>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {entries.map((entry) => (
            <Row key={`${active}-${entry.rank}`} entry={entry} mode={active} />
          ))}
        </ol>
      )}
    </section>
  );
}
