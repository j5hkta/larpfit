import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./env";

/**
 * Refresca el token de sesión y devuelve la respuesta con las cookies ya
 * actualizadas, junto con el usuario validado contra el servidor de Auth.
 *
 * Se llama en cada petición desde proxy.ts. Sin esto, la sesión caduca y
 * aparecen los síntomas clásicos: logouts aleatorios y estado inconsistente.
 */
export async function updateSession(
  request: NextRequest,
): Promise<{ response: NextResponse; user: User | null }> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }

        response = NextResponse.next({ request });

        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }

        // Cabeceras anti-caché que exige @supabase/ssr al escribir cookies de
        // auth: sin ellas un CDN podría servir el token de un usuario a otro.
        for (const [key, value] of Object.entries(headers ?? {})) {
          response.headers.set(key, value);
        }
      },
    },
  });

  // getUser() valida el token contra el servidor de Auth. No uses getSession()
  // para decisiones de seguridad: lee la cookie sin verificarla.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
}
