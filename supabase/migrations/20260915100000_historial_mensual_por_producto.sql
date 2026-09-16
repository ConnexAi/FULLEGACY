-- ============================================================================
-- FULLEGACY — historial_mensual(): una fila por producto, no por (producto, día)
--
-- La versión original (20260908100000_historial_mensual.sql) devuelve una fila
-- por cada combinación (producto, día) con movimiento: hasta 31 días × N
-- productos. Con un catálogo de 40+ productos vendiendo todos los días de un
-- mes de 31 días, eso son hasta 1240 filas — por encima del tope de filas por
-- respuesta que Supabase aplica en PostgREST (Project Settings → API → Max
-- Rows), típicamente 1000.
--
-- Subir ese límite a mano en el dashboard "resuelve" el síntoma pero no la
-- causa, y es la clase de ajuste que alguien puede resetear sin darse cuenta
-- en un cambio de plan o una migración de proyecto. Esta versión elimina el
-- problema de raíz: agrupa los días DENTRO de la fila de cada producto, en un
-- array jsonb. El número de filas pasa a depender solo de cuántos productos
-- tuvieron movimiento ese mes — nunca de los días — así que ni con cientos de
-- productos activos se acerca a ningún tope de PostgREST.
--
-- El cambio es de transporte, no de datos: cada elemento de `dias` es
-- exactamente la fila (dia, pedidos, unidades, no_completados) que antes venía
-- suelta. `src/lib/reportes/historial-mensual.ts` la aplana de vuelta a esa
-- forma plana apenas llega, así que toda la lógica de negocio (construcción de
-- hojas, totales, Excel) queda intacta.
--
-- El resto de la función no cambia: mismo criterio de despacho (FECHA GUIA
-- GENERADA), mismo cálculo de día en hora de Bogotá, misma lista de estados
-- "no completados" recibida como parámetro.
--
-- Se elimina y se recrea (no `create or replace`) porque el tipo de retorno
-- cambia — Postgres no permite reemplazar una función cambiando su forma de
-- salida.
-- ============================================================================

drop function if exists public.historial_mensual(integer, integer, text[]);

create function public.historial_mensual(
  p_anio    integer,
  p_mes     integer,
  p_estados_no_completados text[] default '{}'
)
returns table (
  producto_id  bigint,
  -- Array de { dia, pedidos, unidades, no_completados }, ordenado por día.
  -- Solo trae los días que tuvieron al menos un pedido: igual que antes, un
  -- producto sin movimiento un día no aparece (ni suelto, ni en el array).
  dias         jsonb
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
  ),
  por_dia as (
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
  )
  select
    pd.producto_id,
    jsonb_agg(
      jsonb_build_object(
        'dia', pd.dia,
        'pedidos', pd.pedidos,
        'unidades', pd.unidades,
        'no_completados', pd.no_completados
      )
      order by pd.dia
    ) as dias
  from por_dia pd
  group by pd.producto_id
  order by pd.producto_id;
$$;

comment on function public.historial_mensual(integer, integer, text[]) is
  'Pedidos, unidades y no completados por producto de un mes (hora de Bogotá), con los días agregados en un array jsonb por fila. Solo órdenes con fecha_guia_generada. Una fila por producto activo, no por (producto, día) — así el número de filas no depende de los días del mes.';

-- `security invoker`: corre con los permisos de quien llama, así que las
-- policies de RLS de las tablas siguen aplicando.
revoke all on function public.historial_mensual(integer, integer, text[]) from public;
grant execute on function public.historial_mensual(integer, integer, text[])
  to authenticated, service_role;
