-- ============================================================================
-- FULLEGACY — Sprint 2: datos que necesita el Reporte Ordenado
--
-- Tres cosas:
--   1. `transportadora` y `ciudad_destino` en la orden. Vienen en el export de
--      Dropi (columnas "TRANSPORTADORA" y "CIUDAD DESTINO", presentes en las
--      1620 filas del archivo real) y el parser las estaba ignorando.
--   2. `orden_productos.linea`: la posición del producto dentro de la orden,
--      tal como venía en el archivo. Hace falta porque un combo se muestra
--      como una sola fila ubicada bajo el PRIMER producto que contiene, y el
--      orden de inserción de un INSERT ... GROUP BY no está garantizado.
--   3. Una vista que aplana orden + línea + producto + variación, con el
--      estado ya normalizado para poder filtrar por prefijo.
-- ============================================================================

alter table public.ordenes
  add column if not exists transportadora text,
  add column if not exists ciudad_destino text;

comment on column public.ordenes.transportadora is
  'Columna TRANSPORTADORA del export de Dropi (ENVIA, INTERRAPIDISIMO, TCC, COORDINADORA...).';
comment on column public.ordenes.ciudad_destino is
  'Columna CIUDAD DESTINO del export de Dropi.';

-- ---------------------------------------------------------------------------
-- Posición del producto dentro de la orden (1-based), en orden de archivo.
-- `default 1` para que sea seguro sobre filas ya existentes.
-- ---------------------------------------------------------------------------
alter table public.orden_productos
  add column if not exists linea smallint not null default 1;

comment on column public.orden_productos.linea is
  'Posición de este producto dentro de la orden, en el orden del archivo. El combo se ancla al de linea más baja.';

-- ---------------------------------------------------------------------------
-- Vista plana para los reportes.
--
-- `security_invoker` hace que se apliquen las policies de RLS del usuario que
-- consulta, no las del dueño de la vista. Sin eso, la vista sería un agujero
-- por el que se leerían las tablas saltándose RLS.
-- ---------------------------------------------------------------------------
drop view if exists public.v_lineas_carga;

create view public.v_lineas_carga
  with (security_invoker = true)
as
select
  o.carga_id,
  o.id_orden,
  o.estado,
  -- Normalizado una sola vez acá para que el filtro por prefijo del Reporte
  -- Ordenado ("empieza por PENDIENTE") no dependa de mayúsculas ni espacios.
  upper(btrim(o.estado))            as estado_normalizado,
  o.numero_guia,
  o.transportadora,
  o.ciudad_destino,
  o.fecha_orden,
  o.fecha_guia_generada,
  op.linea,
  op.producto_id,
  p.nombre                          as producto_nombre,
  op.variacion_id,
  pv.texto_variacion,
  pv.unidades_extraidas,
  op.cantidad
from public.ordenes o
  join public.orden_productos op     on op.orden_id = o.id_orden
  join public.productos p            on p.id = op.producto_id
  left join public.producto_variaciones pv on pv.id = op.variacion_id;

comment on view public.v_lineas_carga is
  'Orden + línea + producto + variación, aplanado. Base de los reportes.';

grant select on public.v_lineas_carga to authenticated, service_role;
