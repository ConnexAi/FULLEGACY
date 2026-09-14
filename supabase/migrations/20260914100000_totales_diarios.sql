-- ============================================================================
-- FULLEGACY — Totales diarios sin desglose por producto
--
-- `historial_mensual()` cuenta `distinct id_orden` POR PRODUCTO, que es lo
-- correcto para cada hoja del Excel: si una orden trae Hydra y Waggy pet,
-- ambas hojas deben registrarla.
--
-- Pero al sumar esas filas entre productos, esa misma orden se cuenta dos
-- veces. Los totales agregados del dashboard y del vistazo de inicio quedaban
-- inflados por cada combo.
--
-- Esta función resuelve eso contando a nivel de día, sin pasar por producto.
-- Va aparte y no como columna de `historial_mensual()` porque tiene otro
-- grano: una fila por día, no por (producto, día). Así el Excel no se toca.
--
-- Nota útil: como cada orden tiene una sola `fecha_guia_generada`, pertenece a
-- un único día. Sumar los conteos diarios da el total del mes sin volver a
-- contar nada — el mismo dato sirve para la línea del gráfico y para la cifra.
-- ============================================================================

create or replace function public.totales_diarios(
  p_anio integer,
  p_mes  integer
)
returns table (
  dia       integer,
  pedidos   integer,
  unidades  integer
)
language sql
stable
security invoker
set search_path = public
as $$
  with lineas as (
    select
      o.id_orden,
      op.cantidad,
      (o.fecha_guia_generada at time zone 'America/Bogota')::date as fecha_local
    from public.ordenes o
      join public.orden_productos op on op.orden_id = o.id_orden
    where o.fecha_guia_generada is not null
  )
  select
    extract(day from l.fecha_local)::integer  as dia,
    -- Una orden-combo cuenta UNA vez: es el arreglo respecto de sumar por producto.
    count(distinct l.id_orden)::integer       as pedidos,
    -- Las unidades sí suman todas las líneas: un combo despacha las dos cosas.
    sum(l.cantidad)::integer                  as unidades
  from lineas l
  where l.fecha_local >= make_date(p_anio, p_mes, 1)
    and l.fecha_local <  (make_date(p_anio, p_mes, 1) + interval '1 month')
  group by extract(day from l.fecha_local)
  order by dia;
$$;

comment on function public.totales_diarios(integer, integer) is
  'Pedidos (órdenes únicas) y unidades por día de un mes, sin desglose por producto. Para totales agregados que cruzan productos.';

revoke all on function public.totales_diarios(integer, integer) from public;
grant execute on function public.totales_diarios(integer, integer)
  to authenticated, service_role;
