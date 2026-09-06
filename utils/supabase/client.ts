import { createBrowserClient } from "@supabase/ssr";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./env";

/**
 * Cliente de Supabase para Componentes de Cliente ("use client").
 * La sesión se persiste en cookies para que el servidor pueda leerla.
 */
export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
