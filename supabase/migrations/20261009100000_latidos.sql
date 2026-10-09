-- ============================================================================
-- FULLEGACY — Latidos del keep-alive
--
-- El endpoint /api/cron/keep-alive ya falló dos veces sin que nadie se
-- enterara:
--
--   1. Agosto: faltaban los GRANT, así que el select sobre `productos` moría
--      con "permission denied" (ver 20260826150000_privilegios_tablas.sql).
--   2. 8 de octubre de 2026: el proyecto se pausó igual, con el cron diario
--      configurado en vercel.json. La pausa misma es la prueba de que ninguna
--      petición llegó a Supabase durante 7 días.
--
-- Los dos fallos tienen la misma raíz: nada registra si el keep-alive llegó a
-- correr. Los logs de Vercel en el plan Hobby se retienen poco, y un 401 no
-- deja rastro en ninguna parte.
--
-- Esta tabla es ese rastro, y vive DENTRO de la base que el keep-alive debe
-- mantener viva. Eso es deliberado: la pregunta "¿cuándo fue el último latido
-- de verdad?" se responde con un select, sin depender de los logs de Vercel.
--
--     select ultimo_latido, origen from latidos;
--
-- Una sola fila, siempre la misma (`check (id = 1)`), reescrita en cada
-- ejecución exitosa. No es una bitácora histórica a propósito: lo único que
-- interesa es la última vez, y una tabla que solo crece en un plan gratuito
-- es un problema futuro a cambio de nada.
--
-- Que la tabla esté vacía significa que el endpoint nunca completó una
-- ejecución entera. Es un estado informativo, no un error: por eso no se
-- siembra ninguna fila inicial.
-- ============================================================================

create table if not exists public.latidos (
  -- Fila única. El check es lo que lo garantiza: sin él, un bug en el upsert
  -- podría sembrar filas 2, 3, 4… y la tabla dejaría de significar algo.
  id            integer     primary key
                  check (id = 1),
  ultimo_latido timestamptz not null,
  -- De dónde vino el latido (el `user-agent` de quien llamó). Distingue el
  -- cron real de Vercel de una prueba a mano: si dice `curl/8.x`, el cron
  -- sigue roto y lo que se está viendo es el latido de quien lo probaba.
  origen        text
);

comment on table public.latidos is
  'Marca de la última ejecución exitosa de /api/cron/keep-alive. Una sola fila (id = 1), reescrita en cada corrida. Vacía = el endpoint nunca completó una ejecución entera.';
comment on column public.latidos.origen is
  'user-agent de quien disparó el keep-alive. Permite distinguir el cron de Vercel de una prueba manual.';

-- ---------------------------------------------------------------------------
-- Privilegios.
--
-- Esto es justo lo que se olvidó en agosto y dejó el keep-alive roto seis
-- semanas, así que va explícito y con prueba propia en
-- pruebas/privilegios.test.mjs.
--
-- Solo el servidor toca esta tabla. El navegador no la necesita ni para leer:
-- es diagnóstico de operación, no un dato del negocio.
-- ---------------------------------------------------------------------------
alter table public.latidos enable row level security;

-- Sin policies a propósito: service_role es BYPASSRLS y nadie más entra. RLS
-- queda activado igual para que la tabla siga cerrada si alguien le diera un
-- GRANT a authenticated por error más adelante.

revoke all on public.latidos from anon, authenticated;
grant select, insert, update on public.latidos to service_role;
