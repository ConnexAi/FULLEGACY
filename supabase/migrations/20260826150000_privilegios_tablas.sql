-- ============================================================================
-- FULLEGACY — Privilegios de tabla
--
-- Las migraciones anteriores crearon las tablas y activaron RLS, pero nunca
-- otorgaron privilegios a los roles de Supabase. Sin un GRANT, RLS ni siquiera
-- llega a evaluarse: Postgres rechaza antes con "permission denied".
--
-- Esto tenía dos efectos que ya estaban activos:
--   - /api/cron/keep-alive fallaba (select sobre productos con service_role),
--     así que el proyecto podía pausarse por inactividad igual.
--   - Las policies "lectura_autenticado" no servían de nada.
--
-- `procesar_carga()` seguía funcionando porque es security definer y corre
-- como su dueño (postgres), saltándose los privilegios del invocador.
--
-- Se otorga de forma explícita en vez de depender de los default privileges
-- del proyecto, que dependen de con qué rol se aplicó cada migración.
-- ============================================================================

grant usage on schema public to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tablas de datos.
--
-- El servidor escribe con service_role (salta RLS). El navegador, autenticado,
-- solo lee, y las policies filtran qué.
-- ---------------------------------------------------------------------------
grant select on
    public.productos,
    public.producto_variaciones,
    public.ordenes,
    public.orden_productos
  to authenticated;

grant select, insert, update, delete on
    public.productos,
    public.producto_variaciones,
    public.ordenes,
    public.orden_productos
  to service_role;

-- orden_productos.id es una identity column; su secuencia necesita permiso
-- para cualquier insert que no pase por procesar_carga().
grant usage, select on all sequences in schema public to service_role;

-- ---------------------------------------------------------------------------
-- Lista blanca de acceso.
--
-- Solo el servidor la lee, para resolver quién puede entrar
-- (src/lib/auth/autorizacion.ts). Nunca debe ser visible desde el navegador:
-- es la lista de quién tiene acceso al sistema.
--
-- Solo lectura: dar de alta o de baja un acceso se hace desde el dashboard
-- (como postgres), no desde la app.
-- ---------------------------------------------------------------------------
revoke all on public.usuarios_autorizados from anon, authenticated;
grant select on public.usuarios_autorizados to service_role;
