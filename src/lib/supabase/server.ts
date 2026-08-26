import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { envPublico } from "@/lib/config/env";
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
