import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { envPublico } from "@/lib/config/env";
import type { Database } from "@/lib/supabase/types";

/**
 * Crea un cliente de Supabase atado al par (request, response) del proxy
 * (el antiguo middleware de Next), para refrescar el token de sesión y
 * reenviar las cookies actualizadas.
 *
 * Devuelve también la respuesta, que el proxy debe retornar tal cual
 * (o copiar sus cookies) para no perder el refresh.
 */
export function crearClienteProxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    envPublico.supabaseUrl(),
    envPublico.supabaseAnonKey(),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesAEscribir) {
          for (const { name, value } of cookiesAEscribir) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesAEscribir) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  return { supabase, response };
}
