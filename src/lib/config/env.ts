/**
 * Lectura centralizada y validada de variables de entorno.
 *
 * Fallar aquí (en el arranque / primer uso) es preferible a fallar más
 * adelante con un `undefined` silencioso dentro de una consulta.
 */

function requerido(nombre: string, valor: string | undefined): string {
  if (!valor || valor.trim() === "") {
    throw new Error(
      `Falta la variable de entorno ${nombre}. Revisa .env.local (usa .env.example como plantilla).`,
    );
  }
  return valor;
}

/** Variables públicas: pueden llegar al navegador. */
export const envPublico = {
  supabaseUrl: () =>
    requerido("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: () =>
    requerido(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ),
  siteUrl: () =>
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
    "http://localhost:3000",
} as const;

/** Variables secretas: solo servidor. Nunca importar desde un componente cliente. */
export const envServidor = {
  supabaseServiceRoleKey: () =>
    requerido(
      "SUPABASE_SERVICE_ROLE_KEY",
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    ),
  cronSecret: () => requerido("CRON_SECRET", process.env.CRON_SECRET),

  /**
   * URL de ping del monitor externo del keep-alive (dead man's switch).
   *
   * Opcional: devuelve `null` si no está configurada, y eso no es un error —
   * sin ella el keep-alive funciona igual, solo que nadie avisa si deja de
   * correr. Ver src/app/api/cron/keep-alive/route.ts.
   */
  healthcheckPingUrl: (): string | null =>
    process.env.HEALTHCHECK_PING_URL?.trim() || null,
} as const;
