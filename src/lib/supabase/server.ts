import "server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { envPublico, envServidor } from "@/lib/config/env";
import type { Database } from "@/lib/supabase/types";

/**
 * Cliente de Supabase para Server Components, Route Handlers y Server Actions.
 *
 * Lee/escribe la sesión desde las cookies de la petición, por lo que respeta
 * la identidad del usuario y las policies de RLS.
 */
export async function crearClienteServidor() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    envPublico.supabaseUrl(),
    envPublico.supabaseAnonKey(),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesAEscribir) {
          try {
            for (const { name, value, options } of cookiesAEscribir) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components no pueden escribir cookies. Se ignora:
            // el middleware ya se encarga de refrescar la sesión.
          }
        },
      },
    },
  );
}

/**
 * Cliente administrativo con service_role: SALTA RLS.
 *
 * Solo para tareas de servidor confiables (cron, cargas masivas en sprints
 * posteriores). Nunca exponerlo a través de una ruta pública sin autorizar.
 */
export function crearClienteAdmin() {
  return createClient<Database>(
    envPublico.supabaseUrl(),
    envServidor.supabaseServiceRoleKey(),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
