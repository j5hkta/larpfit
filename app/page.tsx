import { redirect } from "next/navigation";
import { Dumbbell } from "lucide-react";

import { AuthForm } from "@/components/auth/auth-form";
import { createClient } from "@/utils/supabase/server";

export default async function Home({ searchParams }: PageProps<"/">) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Si ya hay sesión no tiene sentido enseñar el formulario.
  if (user) {
    redirect("/play");
  }

  const params = await searchParams;
  const rawError = params.error;
  const initialError = Array.isArray(rawError) ? rawError[0] : rawError;

  return (
    <main className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-4 py-12">
      <div className="arena-glow arena-grid pointer-events-none absolute inset-0" aria-hidden />

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

      <div className="relative flex w-full justify-center">
        <AuthForm initialError={initialError} />
      </div>
    </main>
  );
}
