-- ============================================================================
-- FULLEGACY — historial_mensual_ordenes(): las órdenes del mes, día por día
--
-- El Excel del historial cuenta ahora cada orden en UNA sola hoja: las
-- normales (un solo producto) en la hoja de su producto, y los combos en una
-- hoja "Combos" aparte, con el detalle por tipo de combo. Es la misma regla
-- del conteo del Reporte Ordenado.
--
-- `historial_mensual()` no alcanza para eso: agrega por producto y ya no
-- sabe qué orden era combo ni con qué productos y cantidades (el detalle por
-- tipo de combo los necesita). Esta función devuelve las órdenes despachadas
-- del mes con sus líneas, y la separación normal/combo, el nombre y la
-- agrupación de los combos se hacen en TypeScript con las mismas funciones
-- del Reporte Ordenado (`esCombo`, `contarCombos`). Así la definición de
-- combo vive en un solo lugar y no se duplica en SQL.
--
-- `historial_mensual()` queda intacta: la sigue usando el dashboard.
--
-- Tope de filas de PostgREST: igual que `historial_mensual()`, las órdenes
-- viajan DENTRO de la fila de su día, en un array jsonb. El número de filas
-- es como máximo 31, sin importar cuántas órdenes tenga el mes.
--
-- Mismo criterio que `historial_mensual()` y `totales_diarios()`: solo
-- órdenes con fecha_guia_generada, día en hora de Bogotá, y solo órdenes con
-- al menos una línea (el join). Por eso el número de órdenes de cada día es
-- exactamente el `pedidos` de `totales_diarios()`.
-- ============================================================================

create or replace function public.historial_mensual_ordenes(
  p_anio integer,
  p_mes  integer
)
returns table (
  dia      integer,
  -- Array de { id_orden, estado, lineas: [{ producto_id, cantidad }] },
  -- ordenado por id_orden. `estado` va normalizado (mayúsculas, sin espacios
  -- sobrantes) y las líneas en el orden del archivo, como en el Reporte
  -- Ordenado: el nombre de un combo se arma en ese orden.
  ordenes  jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  with despachadas as (
    select
      o.id_orden,
      upper(btrim(o.estado)) as estado,
      (o.fecha_guia_generada at time zone 'America/Bogota')::date as fecha_local
    from public.ordenes o
    where o.fecha_guia_generada is not null
  ),
  por_orden as (
    select
      extract(day from d.fecha_local)::integer as dia,
      d.id_orden,
      jsonb_build_object(
        'id_orden', d.id_orden,
        'estado', d.estado,
        'lineas', jsonb_agg(
          jsonb_build_object('producto_id', op.producto_id, 'cantidad', op.cantidad)
          order by op.linea, op.producto_id
        )
      ) as orden
    from despachadas d
      join public.orden_productos op on op.orden_id = d.id_orden
    where d.fecha_local >= make_date(p_anio, p_mes, 1)
      and d.fecha_local <  (make_date(p_anio, p_mes, 1) + interval '1 month')
    group by d.fecha_local, d.id_orden, d.estado
  )
  select
    po.dia,
    jsonb_agg(po.orden order by po.id_orden) as ordenes
  from por_orden po
  group by po.dia
  order by po.dia;
$$;

comment on function public.historial_mensual_ordenes(integer, integer) is
  'Órdenes con fecha_guia_generada de un mes (hora de Bogotá) con sus líneas, agrupadas en un array jsonb por día. Una fila por día con movimiento (máximo 31). Para separar normales de combos en el historial mensual.';

-- `security invoker`: corre con los permisos de quien llama, así que las
-- policies de RLS de las tablas siguen aplicando.
revoke all on function public.historial_mensual_ordenes(integer, integer) from public;
grant execute on function public.historial_mensual_ordenes(integer, integer)
  to authenticated, service_role;
