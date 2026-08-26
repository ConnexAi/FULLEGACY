import "server-only";

import { crearClienteAdmin } from "@/lib/supabase/admin";

/**
 * Única fuente de verdad de quién puede entrar: la tabla
 * `public.usuarios_autorizados`.
 *
 * La misma tabla que consulta el trigger sobre `auth.users`
 * (ver supabase/migrations/20260825120100_restriccion_acceso.sql). Antes la
 * app comparaba contra la variable NEXT_PUBLIC_ALLOWED_EMAIL, así que agregar
 * un correo a la tabla no bastaba para poder entrar: la base lo dejaba crear
 * la cuenta y la app lo rechazaba igual.
 *
 * Se consulta con service_role porque la tabla tiene RLS activo y ninguna
 * policy de lectura: es deliberadamente invisible para el navegador.
 */

/**
 * La lista se cachea en memoria porque el proxy la consulta en cada petición.
 * 30 s es suficiente para no golpear la base en cada navegación y lo bastante
 * corto para que revocar un acceso (borrar la fila) surta efecto rápido.
 *
 * El cache es por instancia del servidor; en Vercel cada instancia mantiene el
 * suyo. No es un problema: el peor caso es una consulta extra por instancia.
 */
const TTL_MS = 30_000;

interface Cache {
  correos: Set<string>;
  expiraEn: number;
}

let cache: Cache | null = null;

/** Normaliza como lo hace la migración: `correo = lower(correo)`. */
function normalizar(correo: string): string {
  return correo.trim().toLowerCase();
}

async function leerListaBlanca(): Promise<Set<string>> {
  const supabase = crearClienteAdmin();
  const { data, error } = await supabase
    .from("usuarios_autorizados")
    .select("correo");

  if (error) {
    // Se propaga para que quien llame decida. `esCorreoAutorizado` lo
    // convierte en "no autorizado": ante la duda, no se deja entrar.
    throw new Error(`No se pudo leer la lista de autorizados: ${error.message}`);
  }

  return new Set((data ?? []).map((fila) => normalizar(fila.correo)));
}

/**
 * ¿Este correo está en la lista blanca?
 *
 * Falla cerrado: si la base no responde, devuelve `false`. Perder el acceso
 * momentáneamente es preferible a abrir la puerta por un error de red, y de
 * todos modos sin base de datos la app no sirve para nada.
 *
 * @param opciones.refrescar Ignora el cache y relee la tabla. Se usa en el
 *   login, para que un correo recién agregado pueda entrar sin esperar el TTL.
 */
export async function esCorreoAutorizado(
  correo: string | null | undefined,
  opciones: { refrescar?: boolean } = {},
): Promise<boolean> {
  if (!correo) return false;

  try {
    const correos = await obtenerListaBlanca(opciones.refrescar ?? false);
    return correos.has(normalizar(correo));
  } catch (error) {
    console.error("[autorizacion] no se pudo verificar el correo:", error);
    return false;
  }
}

async function obtenerListaBlanca(refrescar: boolean): Promise<Set<string>> {
  const ahora = Date.now();

  if (!refrescar && cache && cache.expiraEn > ahora) {
    return cache.correos;
  }

  const correos = await leerListaBlanca();
  cache = { correos, expiraEn: ahora + TTL_MS };
  return correos;
}

/** Invalida el cache. Para pruebas y para forzar una relectura inmediata. */
export function invalidarCacheAutorizacion(): void {
  cache = null;
}
