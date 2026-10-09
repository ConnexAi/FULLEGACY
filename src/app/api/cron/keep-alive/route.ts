import { NextResponse, type NextRequest } from "next/server";

import { envServidor } from "@/lib/config/env";
import { crearClienteAdmin } from "@/lib/supabase/admin";

/**
 * Keep-alive de Supabase.
 *
 * Los proyectos gratuitos de Supabase se pausan tras una semana sin actividad.
 * Vercel Cron llama a este endpoint una vez al día (ver vercel.json) y una
 * consulta trivial basta para que el proyecto cuente como activo.
 *
 * Este endpoint ya falló dos veces en silencio: en agosto por los GRANT que
 * faltaban, y el 8 de octubre de 2026 el proyecto se pausó igual con el cron
 * configurado. Las dos veces el problema no fue el fallo sino que nada avisaba.
 * De ahí las tres capas de observabilidad que tiene ahora:
 *
 *   1. `latidos` — deja la marca de la última corrida exitosa DENTRO de la
 *      base, así que "¿cuándo latió por última vez?" se responde con un
 *      select, sin depender de los logs de Vercel (que en Hobby duran poco).
 *   2. El 401 avisa por log y distingue entre "no llegó header" y "llegó pero
 *      no coincide". Antes era un rechazo mudo.
 *   3. `HEALTHCHECK_PING_URL` — un dead man's switch. Las dos capas anteriores
 *      solo sirven si alguien va a mirar; esta es la única que detecta que el
 *      endpoint dejó de correr, porque el monitor avisa cuando el ping NO
 *      llega.
 *
 * No se cachea: debe ejecutarse de verdad en cada llamada.
 */
export const dynamic = "force-dynamic";

/** Techo del ping al monitor. No puede demorar la respuesta del endpoint. */
const TIMEOUT_PING_MS = 5_000;

export async function GET(request: NextRequest) {
  const autorizacion = revisarAutorizacion(request);

  if (!autorizacion.ok) {
    // Sin este log, un 401 es indistinguible de "el cron nunca corrió": las
    // dos cosas se ven igual desde afuera. Nunca se imprime el secreto ni el
    // header, solo la causa y las longitudes, que es lo que hace falta para
    // reconocer el error típico (un salto de línea pegado al copiar el valor).
    console.warn(
      `[keep-alive] 401: ${autorizacion.causa}` +
        ` (longitud recibida ${autorizacion.longitudRecibida},` +
        ` esperada ${autorizacion.longitudEsperada})`,
    );
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

  // El latido va después de la lectura: así la fila solo se escribe cuando el
  // keep-alive de verdad funcionó de punta a punta.
  const ejecutadoEn = new Date().toISOString();
  const { error: errorLatido } = await supabase.from("latidos").upsert(
    {
      id: 1,
      ultimo_latido: ejecutadoEn,
      origen: origenDe(request),
    },
    { onConflict: "id" },
  );

  if (errorLatido) {
    console.error(
      "[keep-alive] no se pudo registrar el latido:",
      errorLatido.message,
    );
    return NextResponse.json(
      { ok: false, error: errorLatido.message },
      { status: 500 },
    );
  }

  // Solo acá, con todo lo anterior en verde. Un ping enviado tras un fallo
  // sería peor que no tener monitor: diría "todo bien" cuando no lo está.
  await avisarAlMonitor();

  return NextResponse.json({
    ok: true,
    productos: count ?? 0,
    ejecutado_en: ejecutadoEn,
  });
}

type Autorizacion =
  | { ok: true }
  | {
      ok: false;
      causa: string;
      longitudRecibida: number;
      longitudEsperada: number;
    };

/**
 * Vercel Cron firma sus llamadas con `Authorization: Bearer $CRON_SECRET`.
 * Sin ese header (o con uno distinto) el endpoint no hace nada.
 *
 * Los dos lados se recortan antes de comparar. Importa porque la comparación
 * arranca por la longitud: un espacio o un salto de línea de más en el valor
 * pegado en el dashboard de Vercel daba 401 para siempre, sin ninguna pista.
 */
function revisarAutorizacion(request: NextRequest): Autorizacion {
  const esperado = `Bearer ${envServidor.cronSecret().trim()}`;
  const recibido = request.headers.get("authorization")?.trim();

  if (!recibido) {
    return {
      ok: false,
      causa: "no llegó header authorization",
      longitudRecibida: 0,
      longitudEsperada: esperado.length,
    };
  }

  if (!comparacionSegura(recibido, esperado)) {
    return {
      ok: false,
      causa: "llegó header authorization pero no coincide",
      longitudRecibida: recibido.length,
      longitudEsperada: esperado.length,
    };
  }

  return { ok: true };
}

function comparacionSegura(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let diferencia = 0;
  for (let i = 0; i < a.length; i += 1) {
    diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diferencia === 0;
}

/**
 * Quién disparó esta corrida, para guardarlo en `latidos.origen`.
 *
 * Es lo que permite distinguir el cron real de Vercel (`vercel-cron/1.0`) de
 * una prueba a mano: un latido fresco con origen `curl/8.x` significa que el
 * cron sigue roto y lo que se está viendo es el latido de quien lo probaba.
 */
function origenDe(request: NextRequest): string {
  const agente = request.headers.get("user-agent")?.trim();
  if (!agente) return "desconocido";
  return agente.slice(0, 120);
}

/**
 * Dead man's switch: le avisa al monitor externo que esta corrida terminó bien.
 *
 * El monitor (Healthchecks.io y equivalentes) avisa cuando el ping NO llega,
 * que es el único fallo que las otras dos capas no pueden detectar: un cron
 * que dejó de dispararse no deja ni log ni latido.
 *
 * Best effort a propósito. Si el monitor está caído, el keep-alive YA cumplió
 * su trabajo — la base recibió su consulta — y hacer fallar la respuesta solo
 * convertiría la caída del monitor en una alarma falsa de Vercel.
 */
async function avisarAlMonitor(): Promise<void> {
  const url = envServidor.healthcheckPingUrl();
  if (!url) return;

  try {
    const respuesta = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(TIMEOUT_PING_MS),
    });

    if (!respuesta.ok) {
      // La URL lleva el identificador del monitor, así que nunca se loguea.
      console.warn(
        `[keep-alive] el monitor respondió ${respuesta.status} al ping; el keep-alive sí corrió`,
      );
    }
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    console.warn(
      `[keep-alive] no se pudo avisar al monitor (${motivo}); el keep-alive sí corrió`,
    );
  }
}
