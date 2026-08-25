import { NextResponse, type NextRequest } from "next/server";

import { envServidor } from "@/lib/config/env";
import { crearClienteAdmin } from "@/lib/supabase/server";

/**
 * Keep-alive de Supabase.
 *
 * Los proyectos gratuitos de Supabase se pausan tras una semana sin actividad.
 * Vercel Cron llama a este endpoint una vez al día (ver vercel.json) y una
 * consulta trivial basta para que el proyecto cuente como activo.
 *
 * No se cachea: debe ejecutarse de verdad en cada llamada.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!estaAutorizado(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const supabase = crearClienteAdmin();

  // Consulta mínima: solo el conteo, sin traer filas.
  const { count, error } = await supabase
    .from("productos")
    .select("id", { count: "exact", head: true });

  if (error) {
    console.error("[keep-alive] fallo la consulta a Supabase:", error.message);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    productos: count ?? 0,
    ejecutado_en: new Date().toISOString(),
  });
}

/**
 * Vercel Cron firma sus llamadas con `Authorization: Bearer $CRON_SECRET`.
 * Sin ese header (o con uno distinto) el endpoint no hace nada.
 */
function estaAutorizado(request: NextRequest): boolean {
  const recibido = request.headers.get("authorization");
  if (!recibido) return false;

  const esperado = `Bearer ${envServidor.cronSecret()}`;

  // Comparación de longitud constante para no filtrar el secreto por timing.
  return comparacionSegura(recibido, esperado);
}

function comparacionSegura(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let diferencia = 0;
  for (let i = 0; i < a.length; i += 1) {
    diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diferencia === 0;
}
