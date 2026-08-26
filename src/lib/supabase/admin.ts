import "server-only";

import { createClient } from "@supabase/supabase-js";

import { envPublico, envServidor } from "@/lib/config/env";
import type { Database } from "@/lib/supabase/types";

/**
 * Cliente administrativo con service_role: SALTA RLS.
 *
 * Vive en su propio módulo (y no junto a `crearClienteServidor`) porque el
 * proxy lo necesita para resolver la lista blanca, y no debe arrastrar
 * `next/headers` — `cookies()` no existe en ese contexto.
 *
 * Solo para tareas de servidor confiables. Nunca exponerlo a través de una
 * ruta pública sin autorizar.
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
