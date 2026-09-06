import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./env";

/**
 * Cliente de Supabase para Server Components, Server Actions y Route Handlers.
 *
 * Crea SIEMPRE un cliente nuevo por petición: nunca lo compartas entre
 * peticiones, o acabarías sirviendo la sesión de un usuario a otro.
 */
export async function createClient() {
  // En Next 16 `cookies()` es asíncrono.
  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Los Server Components no pueden escribir cookies. No es un problema:
          // el proxy (proxy.ts) ya refresca la sesión en cada petición.
        }
      },
    },
  });
}
