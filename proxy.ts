import { NextResponse, type NextRequest } from "next/server";

import { updateSession } from "@/utils/supabase/proxy";

/**
 * En Next.js 16 el convenio `middleware.ts` está deprecado y se llama `proxy.ts`.
 * La funcionalidad es idéntica: se ejecuta antes de renderizar cada ruta.
 *
 * Responsabilidades:
 *  1. Refrescar la sesión de Supabase (reescribiendo las cookies).
 *  2. Proteger las rutas privadas redirigiendo a / si no hay sesión.
 */

const PROTECTED_ROUTES = ["/play"];

export async function proxy(request: NextRequest) {
  const { response, user } = await updateSession(request);

  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );

  if (isProtected && !user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/";
    loginUrl.search = "";
    loginUrl.searchParams.set("error", "Inicia sesión para entrar a la arena.");

    const redirectResponse = NextResponse.redirect(loginUrl);

    // Arrastramos las cookies ya refrescadas para no perder el trabajo que
    // acaba de hacer updateSession().
    for (const cookie of response.cookies.getAll()) {
      redirectResponse.cookies.set(cookie);
    }

    return redirectResponse;
  }

  return response;
}

export const config = {
  /**
   * Excluimos assets estáticos e imágenes: sin esto el proxy se ejecuta en cada
   * archivo y la lógica de auth puede llegar a bloquear CSS, JS o imágenes.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
