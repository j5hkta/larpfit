import { redirect } from "next/navigation";
import { Dumbbell } from "lucide-react";

import { AuthForm } from "@/components/auth/auth-form";
import { Leaderboard } from "@/components/Leaderboard";
import {
  LEADERBOARD_SIZE,
  type LeaderboardEntry,
  normalizeEntries,
} from "@/lib/leaderboard";
import type { GameMode } from "@/types/match";
import { createClient } from "@/utils/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Clasificación de una disciplina.
 *
 * Si falla (migración sin aplicar, base caída) devolvemos lista vacía: la
 * portada tiene que seguir dejando entrar aunque la tabla no cargue.
 */
async function fetchLeaderboard(
  supabase: SupabaseServerClient,
  mode: GameMode,
): Promise<LeaderboardEntry[]> {
  const { data, error } = await supabase.rpc("get_global_leaderboard", {
    p_game_mode: mode,
    p_limit: LEADERBOARD_SIZE,
  });

  if (error) {
    console.error(`[leaderboard] ${mode}:`, error.message);
    return [];
  }

  return normalizeEntries(data);
}

export default async function Home({ searchParams }: PageProps<"/">) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Si ya hay sesión no tiene sentido enseñar el formulario.
  if (user) {
    redirect("/play");
  }

  // Se piden en paralelo y en el servidor: la tabla llega ya pintada en el
  // HTML, sin spinner ni salto de layout en la primera carga.
  const [aesthetics, performance] = await Promise.all([
    fetchLeaderboard(supabase, "aesthetics"),
    fetchLeaderboard(supabase, "performance"),
  ]);

  const params = await searchParams;
  const rawError = params.error;
  const initialError = Array.isArray(rawError) ? rawError[0] : rawError;

  return (
    <main className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-4 py-12">
      <div
        className="arena-glow arena-grid pointer-events-none absolute inset-0"
        aria-hidden
      />

      <header className="relative mb-8 flex flex-col items-center text-center">
        <div className="mb-4 flex size-14 items-center justify-center rounded-2xl border border-volt-500/40 bg-volt-500/10">
          <Dumbbell aria-hidden className="size-7 text-volt-400" />
        </div>
        <h1 className="text-4xl font-black uppercase tracking-tight text-white sm:text-5xl">
          Larp<span className="text-volt-400">fit</span>
        </h1>
        <p className="mt-3 max-w-sm text-sm text-arena-300">
          Ruleta 1v1. Te emparejamos con alguien de tu país y tienes{" "}
          <span className="font-semibold text-white">15 segundos</span> para
          flexear. La IA decide quién gana.
        </p>
      </header>

      <div className="relative flex w-full flex-col items-center gap-8">
        <AuthForm initialError={initialError} />
        <Leaderboard aesthetics={aesthetics} performance={performance} />
      </div>
    </main>
  );
}
