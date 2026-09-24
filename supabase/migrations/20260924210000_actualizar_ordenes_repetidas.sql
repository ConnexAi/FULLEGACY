-- ============================================================================
-- FULLEGACY — procesar_carga() v4: una orden repetida se actualiza, no se omite
--
-- Hasta acá, una orden cuyo id ya existía se descartaba entera y no se volvía
-- a tocar nunca. Funcionó mientras Diego subía un archivo cada varios días,
-- pero ahora sube varios el mismo día mientras las órdenes van cambiando de
-- estado: la versión de la mañana quedaba congelada para siempre.
--
-- Medido en producción el 2026-09-24: las 90 órdenes de las dos cargas de la
-- mañana quedaron en PENDIENTE sin fecha de guía —así que no entraban al
-- historial mensual— mientras los archivos de la tarde, que ya las traían con
-- guía, se descartaban enteros. Una de esas cargas procesó 349 órdenes y no
-- guardó ni una.
--
-- Ahora una orden repetida actualiza sus campos mutables con los del archivo
-- nuevo, con dos matices:
--
--   - `fecha_guia_generada` y `numero_guia` van con coalesce(nuevo, viejo): si
--     alguien resube por error un archivo viejo, donde esos campos vienen en
--     NULL, no pueden borrar una guía que ya teníamos. `estado`, `fecha_orden`,
--     `transportadora` y `ciudad_destino` sí se sobrescriben directo.
--
--   - `carga_id` se muda siempre a la carga nueva, haya traído datos distintos
--     o no. El Reporte Ordenado filtra por carga, así que de este modo el
--     reporte del último archivo muestra lo que está pendiente de verdad en
--     ese momento, en vez de solo las órdenes que nunca se habían visto.
--
-- `orden_productos` no se toca: los productos y cantidades de una orden los
-- fija Dropi al crearla, y todo lo que muta (estado, guía, transportadora)
-- vive en `ordenes`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Contadores del resumen: "omitidas" deja de tener sentido y lo reemplazan
-- "actualizadas" (el archivo trajo datos distintos) y "sin cambios" (la orden
-- ya estaba, idéntica).
-- ---------------------------------------------------------------------------
alter table public.cargas
  add column if not exists ordenes_actualizadas integer not null default 0,
  add column if not exists ordenes_sin_cambios  integer not null default 0;

comment on column public.cargas.ordenes_actualizadas is
  'Órdenes que ya existían y el archivo trajo con algún dato distinto.';
comment on column public.cargas.ordenes_sin_cambios is
  'Órdenes que ya existían y el archivo trajo idénticas.';
comment on column public.cargas.ordenes_omitidas is
  'Histórico: órdenes descartadas por repetidas, del comportamiento anterior al 2026-09-24. Las cargas nuevas lo dejan en 0 — ver ordenes_actualizadas y ordenes_sin_cambios.';

create or replace function public.procesar_carga(p_carga jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_carga_id             bigint;
  v_lineas_sin_prod      bigint   := 0;
  v_ids_entrada          bigint[] := '{}';
  v_ids_existentes       bigint[] := '{}';
  v_ordenes_nuevas       bigint   := 0;
  v_ordenes_actualizadas bigint   := 0;
  v_ordenes_sin_cambios  bigint   := 0;
  v_lineas_insertadas    bigint   := 0;
  v_productos_antes      bigint   := 0;
  v_productos_despues    bigint   := 0;
  v_variaciones_antes    bigint   := 0;
  v_variaciones_desp     bigint   := 0;
begin
  -- ---------------------------------------------------------------------
  -- 0. Contrato: toda línea debe traer producto_id.
  --
  -- Se valida primero, antes de insertar nada, para que el mensaje diga qué
  -- pasa de verdad en lugar de reventar más adelante contra el NOT NULL.
  -- ---------------------------------------------------------------------
  select count(*)
    into v_lineas_sin_prod
  from jsonb_array_elements(coalesce(p_carga->'ordenes', '[]'::jsonb)) x
  cross join lateral jsonb_array_elements(coalesce(x->'lineas', '[]'::jsonb)) l
  where nullif(trim(coalesce(l->>'producto_id', '')), '') is null;

  if v_lineas_sin_prod > 0 then
    raise exception
      'Carga rechazada: % linea(s) llegaron sin producto_id. La aplicacion que envio los datos usa el modelo anterior (la linea apuntaba solo a la variacion). Hay que desplegar la version que manda producto_id en cada linea.',
      v_lineas_sin_prod
      using errcode = '22004';  -- null_value_not_allowed
  end if;

  -- ---------------------------------------------------------------------
  -- 1. La carga se registra primero: su id se necesita para las órdenes.
  -- ---------------------------------------------------------------------
  insert into public.cargas (nombre_archivo, filas_leidas, filas_con_error)
  values (
    coalesce(nullif(trim(p_carga #>> '{archivo,nombre}'), ''), 'archivo sin nombre'),
    coalesce((p_carga #>> '{archivo,filas_leidas}')::integer, 0),
    coalesce((p_carga #>> '{archivo,filas_con_error}')::integer, 0)
  )
  returning id into v_carga_id;

  -- ---------------------------------------------------------------------
  -- 2. Catálogo: productos.
  -- ---------------------------------------------------------------------
  select count(*) into v_productos_antes from public.productos;

  insert into public.productos (id, nombre, sku)
  select distinct on (p.id) p.id, p.nombre, p.sku
  from (
    select (x->>'id')::bigint as id,
           coalesce(nullif(trim(x->>'nombre'), ''), 'Producto ' || (x->>'id')) as nombre,
           nullif(trim(x->>'sku'), '') as sku
    from jsonb_array_elements(coalesce(p_carga->'productos', '[]'::jsonb)) x
  ) p
  order by p.id
  on conflict (id) do update
    set nombre = excluded.nombre,
        sku    = coalesce(excluded.sku, productos.sku);

  select count(*) into v_productos_despues from public.productos;

  -- ---------------------------------------------------------------------
  -- 3. Catálogo: variaciones.
  -- ---------------------------------------------------------------------
  select count(*) into v_variaciones_antes from public.producto_variaciones;

  insert into public.producto_variaciones
    (id, producto_id, sku, texto_variacion, unidades_extraidas)
  select distinct on (v.id)
         v.id, v.producto_id, v.sku, v.texto_variacion, v.unidades_extraidas
  from (
    select (x->>'id')::bigint                      as id,
           (x->>'producto_id')::bigint             as producto_id,
           nullif(trim(x->>'sku'), '')             as sku,
           nullif(trim(x->>'texto_variacion'), '') as texto_variacion,
           (x->>'unidades_extraidas')::numeric     as unidades_extraidas
    from jsonb_array_elements(coalesce(p_carga->'variaciones', '[]'::jsonb)) x
  ) v
  order by v.id
  on conflict (id) do update
    set producto_id        = excluded.producto_id,
        sku                = coalesce(excluded.sku, producto_variaciones.sku),
        texto_variacion    = coalesce(excluded.texto_variacion,
                                      producto_variaciones.texto_variacion),
        unidades_extraidas = coalesce(excluded.unidades_extraidas,
                                      producto_variaciones.unidades_extraidas);

  select count(*) into v_variaciones_desp from public.producto_variaciones;

  -- ---------------------------------------------------------------------
  -- 4. Qué órdenes del archivo ya existían.
  -- ---------------------------------------------------------------------
  select coalesce(array_agg(distinct (x->>'id_orden')::bigint), '{}')
    into v_ids_entrada
  from jsonb_array_elements(coalesce(p_carga->'ordenes', '[]'::jsonb)) x;

  select coalesce(array_agg(o.id_orden), '{}')
    into v_ids_existentes
  from public.ordenes o
  where o.id_orden = any (v_ids_entrada);

  -- ---------------------------------------------------------------------
  -- 5. Órdenes repetidas: se actualizan con lo que trae el archivo nuevo.
  --
  -- Va ANTES de insertar las nuevas a propósito: así este UPDATE solo puede
  -- alcanzar filas que ya estaban, y no las que se acaban de crear.
  --
  -- El `is distinct from` compara las dos filas enteras: si el archivo no
  -- trajo nada distinto, la fila no se toca y cuenta como "sin cambios".
  -- `carga_id` queda fuera de esa comparación a propósito — se muda igual
  -- (paso 6), pero mudarse de carga no es traer datos nuevos.
  -- ---------------------------------------------------------------------
  update public.ordenes o
     set estado              = n.estado,
         fecha_orden         = n.fecha_orden,
         -- coalesce: un archivo viejo, con estos campos en NULL, no puede
         -- borrar una guía que ya teníamos.
         fecha_guia_generada = coalesce(n.fecha_guia_generada, o.fecha_guia_generada),
         numero_guia         = coalesce(n.numero_guia, o.numero_guia),
         transportadora      = n.transportadora,
         ciudad_destino      = n.ciudad_destino
  from (
    select distinct on (e.id_orden)
           e.id_orden, e.estado, e.fecha_orden, e.fecha_guia_generada,
           e.numero_guia, e.transportadora, e.ciudad_destino
    from (
      select (x->>'id_orden')::bigint                            as id_orden,
             x->>'estado'                                        as estado,
             (x->>'fecha_orden')::timestamptz                    as fecha_orden,
             nullif(x->>'fecha_guia_generada', '')::timestamptz  as fecha_guia_generada,
             nullif(trim(x->>'numero_guia'), '')                 as numero_guia,
             nullif(trim(x->>'transportadora'), '')              as transportadora,
             nullif(trim(x->>'ciudad_destino'), '')              as ciudad_destino
      from jsonb_array_elements(coalesce(p_carga->'ordenes', '[]'::jsonb)) x
    ) e
    order by e.id_orden
  ) n
 where o.id_orden = n.id_orden
   and o.id_orden = any (v_ids_existentes)
   and (o.estado, o.fecha_orden, o.fecha_guia_generada,
        o.numero_guia, o.transportadora, o.ciudad_destino)
       is distinct from
       (n.estado, n.fecha_orden,
        coalesce(n.fecha_guia_generada, o.fecha_guia_generada),
        coalesce(n.numero_guia, o.numero_guia),
        n.transportadora, n.ciudad_destino);

  get diagnostics v_ordenes_actualizadas = row_count;

  v_ordenes_sin_cambios := cardinality(v_ids_existentes) - v_ordenes_actualizadas;

  -- ---------------------------------------------------------------------
  -- 6. Toda orden repetida se muda a la carga nueva, haya cambiado o no.
  --
  -- Es lo que hace que el Reporte Ordenado del último archivo muestre todo lo
  -- que sigue pendiente en él, y no solo las órdenes que nunca se habían visto.
  -- ---------------------------------------------------------------------
  update public.ordenes
     set carga_id = v_carga_id
   where id_orden = any (v_ids_existentes);

  -- ---------------------------------------------------------------------
  -- 7. Órdenes nuevas, atadas a esta carga.
  -- ---------------------------------------------------------------------
  insert into public.ordenes
    (id_orden, estado, fecha_orden, fecha_guia_generada, numero_guia,
     transportadora, ciudad_destino, carga_id)
  select distinct on (o.id_orden)
         o.id_orden, o.estado, o.fecha_orden, o.fecha_guia_generada,
         o.numero_guia, o.transportadora, o.ciudad_destino, v_carga_id
  from (
    select (x->>'id_orden')::bigint                            as id_orden,
           x->>'estado'                                        as estado,
           (x->>'fecha_orden')::timestamptz                    as fecha_orden,
           nullif(x->>'fecha_guia_generada', '')::timestamptz  as fecha_guia_generada,
           nullif(trim(x->>'numero_guia'), '')                 as numero_guia,
           nullif(trim(x->>'transportadora'), '')              as transportadora,
           nullif(trim(x->>'ciudad_destino'), '')              as ciudad_destino
    from jsonb_array_elements(coalesce(p_carga->'ordenes', '[]'::jsonb)) x
  ) o
  where o.id_orden <> all (v_ids_existentes)
  order by o.id_orden;

  get diagnostics v_ordenes_nuevas = row_count;

  -- ---------------------------------------------------------------------
  -- 8. Líneas, solo de las órdenes nuevas.
  --
  -- Las de una orden repetida no se tocan: sus productos y cantidades no
  -- cambian entre archivos, y reinsertarlas chocaría con el unique
  -- (orden_id, producto_id, variacion_id).
  --
  -- `linea` conserva la posición en el archivo. Si dos filas se fusionan por
  -- ser el mismo (producto, variación), gana la posición más temprana.
  -- ---------------------------------------------------------------------
  insert into public.orden_productos
    (orden_id, producto_id, variacion_id, cantidad, linea)
  select o.id_orden,
         (l->>'producto_id')::bigint,
         nullif(l->>'variacion_id', '')::bigint,
         sum((l->>'cantidad')::integer),
         min(coalesce((l->>'linea')::smallint, 1))
  from jsonb_array_elements(coalesce(p_carga->'ordenes', '[]'::jsonb)) x
  cross join lateral (select (x->>'id_orden')::bigint as id_orden) o
  cross join lateral jsonb_array_elements(coalesce(x->'lineas', '[]'::jsonb)) l
  where o.id_orden <> all (v_ids_existentes)
  group by o.id_orden,
           (l->>'producto_id')::bigint,
           nullif(l->>'variacion_id', '')::bigint;

  get diagnostics v_lineas_insertadas = row_count;

  -- ---------------------------------------------------------------------
  -- 9. Resultado.
  -- ---------------------------------------------------------------------
  update public.cargas
     set ordenes_nuevas       = v_ordenes_nuevas,
         ordenes_actualizadas = v_ordenes_actualizadas,
         ordenes_sin_cambios  = v_ordenes_sin_cambios,
         productos_nuevos     = v_productos_despues - v_productos_antes,
         variaciones_nuevas   = v_variaciones_desp - v_variaciones_antes
   where id = v_carga_id;

  return jsonb_build_object(
    'carga_id',             v_carga_id,
    'ordenes_nuevas',       v_ordenes_nuevas,
    'ordenes_actualizadas', v_ordenes_actualizadas,
    'ordenes_sin_cambios',  v_ordenes_sin_cambios,
    'ids_existentes',       to_jsonb(v_ids_existentes),
    'lineas_insertadas',    v_lineas_insertadas,
    'productos_nuevos',     v_productos_despues - v_productos_antes,
    'variaciones_nuevas',   v_variaciones_desp - v_variaciones_antes
  );
end;
$$;

comment on function public.procesar_carga(jsonb) is
  'Persiste una carga de Dropi en una sola transacción. Las órdenes nuevas se insertan; las repetidas se actualizan con los datos del archivo nuevo y se mudan a la carga nueva.';

revoke all on function public.procesar_carga(jsonb) from public;
revoke all on function public.procesar_carga(jsonb) from anon, authenticated;
grant execute on function public.procesar_carga(jsonb) to service_role;
