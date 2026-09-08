-- ============================================================================
-- FULLEGACY — Sprint 3: agregación del historial mensual
--
-- Devuelve, por producto y por día del mes, cuántos pedidos y unidades se
-- despacharon, más un conteo de los que quedaron en un estado "no completado".
--
-- Criterio de despacho (confirmado con Diego y verificado contra datos reales):
-- la orden cuenta si tiene FECHA GUIA GENERADA. Sin esa fecha no se envió
-- nunca, así que no entra. En la práctica equivale a excluir PENDIENTE y
-- CANCELADO, pero la regla se expresa por la fecha, no por el estado.
--
-- El día se calcula en hora de Bogotá: una guía generada a las 9 pm del día 2
-- es del día 2, no del 3 como diría UTC.
--
-- La lista de estados "no completados" llega como parámetro a propósito: vive
-- como constante en el código de la app (ESTADOS_NO_COMPLETADOS), no como
-- configuración en la base. Agregar un estado es cambiar esa línea.
--
-- Se agrega en SQL y no en la app porque PostgREST corta en 1000 filas: un mes
-- son ~1600 órdenes, pero como máximo 31 días × los productos que existan.
-- ============================================================================

create or replace function public.historial_mensual(
  p_anio    integer,
  p_mes     integer,
  p_estados_no_completados text[] default '{}'
)
returns table (
  producto_id     bigint,
  dia             integer,
  pedidos         integer,
  unidades        integer,
  no_completados  integer
)
language sql
stable
security invoker
set search_path = public
as $$
  with dia_bogota as (
    select
      op.producto_id,
      o.id_orden,
      upper(btrim(o.estado)) as estado,
      op.cantidad,
      (o.fecha_guia_generada at time zone 'America/Bogota')::date as fecha_local
    from public.ordenes o
      join public.orden_productos op on op.orden_id = o.id_orden
    where o.fecha_guia_generada is not null
  )
  select
    d.producto_id,
    extract(day from d.fecha_local)::integer                  as dia,
    -- Un combo aporta una vez a cada producto que lo compone.
    count(distinct d.id_orden)::integer                       as pedidos,
    sum(d.cantidad)::integer                                  as unidades,
    count(distinct d.id_orden)
      filter (where d.estado = any (
        select upper(btrim(e)) from unnest(p_estados_no_completados) e
      ))::integer                                             as no_completados
  from dia_bogota d
  where d.fecha_local >= make_date(p_anio, p_mes, 1)
    and d.fecha_local <  (make_date(p_anio, p_mes, 1) + interval '1 month')
  group by d.producto_id, extract(day from d.fecha_local)
  order by d.producto_id, dia;
$$;

comment on function public.historial_mensual(integer, integer, text[]) is
  'Pedidos, unidades y no completados por producto y día (hora de Bogotá) de un mes. Solo órdenes con fecha_guia_generada.';

-- `security invoker`: corre con los permisos de quien llama, así que las
-- policies de RLS de las tablas siguen aplicando.
revoke all on function public.historial_mensual(integer, integer, text[]) from public;
grant execute on function public.historial_mensual(integer, integer, text[])
  to authenticated, service_role;
