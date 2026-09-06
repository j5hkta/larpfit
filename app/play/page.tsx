import { LogOut, Radar } from "lucide-react";

import { logout } from "@/app/auth/actions";
import { countryName } from "@/lib/countries";
import { createClient } from "@/utils/supabase/server";

export default async function PlayPage() {
  const supabase = await createClient();

  // El proxy ya bloquea esta ruta sin sesión; aquí solo leemos el perfil.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("username, country")
    .eq("id", user?.id ?? "")
    .single();

  return (
    <main className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-4 py-12 text-center">
      <div className="arena-glow arena-grid pointer-events-none absolute inset-0" aria-hidden />

      <Radar aria-hidden className="relative mb-6 size-10 animate-pulse text-volt-400" />

      <h1 className="relative text-2xl font-black uppercase tracking-tight text-white sm:text-3xl">
        Bienvenido a Larpfit. Buscando oponente...
      </h1>

      {profile && (
        <p className="relative mt-4 text-sm text-arena-300">
          <span className="font-semibold text-white">{profile.username}</span>
          {profile.country && ` · ${countryName(profile.country) ?? profile.country}`}
        </p>
      )}

      <p className="relative mt-2 text-xs uppercase tracking-widest text-arena-500">
        Fase 3: cola, emparejamiento y videollamada
      </p>

      <form action={logout} className="relative mt-10">
        <button
          type="submit"
          className="flex items-center gap-2 rounded-lg border border-arena-700 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-arena-300 transition-colors hover:border-flex-500/50 hover:text-flex-400"
        >
          <LogOut aria-hidden className="size-4" />
          Cerrar sesión
        </button>
      </form>
    </main>
  );
}
