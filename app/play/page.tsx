import { LogOut, UserX } from "lucide-react";

import { logout } from "@/app/auth/actions";
import { PlayArena } from "@/components/PlayArena";
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
    .single<{ username: string; country: string | null }>();

  // Sin perfil o sin región no se puede emparejar: el país define la cola.
  const canPlay = Boolean(user && profile?.country);

  return (
    <main className="relative flex flex-1 flex-col overflow-hidden">
      <div
        className="arena-glow arena-grid pointer-events-none absolute inset-0"
        aria-hidden
      />

      <div className="relative flex flex-1 flex-col">
        {canPlay && user && profile ? (
          <PlayArena
            userId={user.id}
            username={profile.username}
            country={profile.country as string}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center px-4 py-12 text-center">
            <UserX aria-hidden className="mb-6 size-10 text-flex-400" />
            <h1 className="text-2xl font-black uppercase tracking-tight text-white">
              Tu perfil está incompleto
            </h1>
            <p className="mt-3 max-w-sm text-sm text-arena-300">
              No encontramos tu región, y sin ella no podemos emparejarte.
              Cierra sesión y vuelve a crear la cuenta eligiendo un país.
            </p>
          </div>
        )}

        <footer className="relative flex justify-center pb-6">
          <form action={logout}>
            <button
              type="submit"
              className="flex items-center gap-2 rounded-lg border border-arena-700 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-arena-300 transition-colors hover:border-flex-500/50 hover:text-flex-400"
            >
              <LogOut aria-hidden className="size-4" />
              Cerrar sesión
            </button>
          </form>
        </footer>
      </div>
    </main>
  );
}
