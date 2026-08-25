"use client";

import { createBrowserClient } from "@supabase/ssr";

import { envPublico } from "@/lib/config/env";
import type { Database } from "@/lib/supabase/types";

/**
 * Cliente de Supabase para el navegador (Client Components).
 *
 * Usa la anon key, así que todo lo que haga pasa por RLS.
 * `createBrowserClient` guarda la sesión en cookies para que el servidor
 * pueda leerla también.
 */
export function crearClienteNavegador() {
  return createBrowserClient<Database>(
    envPublico.supabaseUrl(),
    envPublico.supabaseAnonKey(),
  );
}
