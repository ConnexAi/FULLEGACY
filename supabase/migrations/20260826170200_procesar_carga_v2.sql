-- ============================================================================
-- FULLEGACY — procesar_carga() v2
--
-- Cambios respecto a la v1:
--   - La línea de orden lleva producto_id siempre y variacion_id opcional.
--   - Registra la carga en `cargas` y ata las órdenes a ella.
--   - `productos.sku` para los productos sin variantes.
--
-- Sigue siendo una sola transacción: o queda el archivo entero, o nada.
--
-- Estructura esperada de p_carga:
--   {
--     "archivo":     { "nombre": "export.xlsx", "filas_leidas": 1620,
--                      "filas_con_error": 0 },
--     "productos":   [ { "id": 2103415, "nombre": "Waggy pet", "sku": "5038494" } ],
--     "variaciones": [ { "id": 2109232, "producto_id": 2105813, "sku": "463830-0",
--                        "texto_variacion": "1 unidad", "unidades_extraidas": 1 } ],
--     "ordenes":     [ { "id_orden": 123, "estado": "ENTREGADO",
--                        "fecha_orden": "2026-04-03T15:30:00Z",
--                        "fecha_guia_generada": null, "numero_guia": "240012345",
--                        "lineas": [ { "producto_id": 2103415,
--                                      "variacion_id": null, "cantidad": 1 } ] } ]
--   }
-- ============================================================================

create or replace function public.procesar_carga(p_carga jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_carga_id           bigint;
  v_ids_entrada        bigint[] := '{}';
  v_ids_omitidos       bigint[] := '{}';
  v_ordenes_nuevas     bigint   := 0;
  v_lineas_insertadas  bigint   := 0;
  v_productos_antes    bigint   := 0;
  v_productos_despues  bigint   := 0;
  v_variaciones_antes  bigint   := 0;
  v_variaciones_desp   bigint   := 0;
begin
  -- ---------------------------------------------------------------------
  -- 0. La carga se registra primero: su id se necesita para las órdenes.
  --    Los contadores del resultado se completan al final.
  -- ---------------------------------------------------------------------
  insert into public.cargas (nombre_archivo, filas_leidas, filas_con_error)
  values (
    coalesce(nullif(trim(p_carga #>> '{archivo,nombre}'), ''), 'archivo sin nombre'),
    coalesce((p_carga #>> '{archivo,filas_leidas}')::integer, 0),
    coalesce((p_carga #>> '{archivo,filas_con_error}')::integer, 0)
  )
  returning id into v_carga_id;

  -- ---------------------------------------------------------------------
  -- 1. Catálogo: productos.
  --
  -- `sku` solo llega para productos sin variantes; el coalesce evita que una
  -- carga posterior lo borre si esa vez no vino.
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
  -- 2. Catálogo: variaciones. Solo las de los productos que sí las manejan.
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
  -- 3. Control de duplicados: las órdenes que ya existen se omiten enteras.
  -- ---------------------------------------------------------------------
  select coalesce(array_agg(distinct (x->>'id_orden')::bigint), '{}')
    into v_ids_entrada
  from jsonb_array_elements(coalesce(p_carga->'ordenes', '[]'::jsonb)) x;

  select coalesce(array_agg(o.id_orden), '{}')
    into v_ids_omitidos
  from public.ordenes o
  where o.id_orden = any (v_ids_entrada);

  -- ---------------------------------------------------------------------
  -- 4. Órdenes nuevas, atadas a esta carga.
  -- ---------------------------------------------------------------------
  insert into public.ordenes
    (id_orden, estado, fecha_orden, fecha_guia_generada, numero_guia, carga_id)
  select distinct on (o.id_orden)
         o.id_orden, o.estado, o.fecha_orden, o.fecha_guia_generada,
         o.numero_guia, v_carga_id
  from (
    select (x->>'id_orden')::bigint                            as id_orden,
           x->>'estado'                                        as estado,
           (x->>'fecha_orden')::timestamptz                    as fecha_orden,
           nullif(x->>'fecha_guia_generada', '')::timestamptz  as fecha_guia_generada,
           nullif(trim(x->>'numero_guia'), '')                 as numero_guia
    from jsonb_array_elements(coalesce(p_carga->'ordenes', '[]'::jsonb)) x
  ) o
  where o.id_orden <> all (v_ids_omitidos)
  order by o.id_orden;

  get diagnostics v_ordenes_nuevas = row_count;

  -- ---------------------------------------------------------------------
  -- 5. Líneas. Una fila por producto de la orden → así se guardan los combos.
  --
  -- El GROUP BY agrupa los NULL de variacion_id igual que el unique
  -- NULLS NOT DISTINCT, así que dos líneas del mismo producto sin variación
  -- se suman en vez de chocar.
  -- ---------------------------------------------------------------------
  insert into public.orden_productos (orden_id, producto_id, variacion_id, cantidad)
  select o.id_orden,
         (l->>'producto_id')::bigint,
         nullif(l->>'variacion_id', '')::bigint,
         sum((l->>'cantidad')::integer)
  from jsonb_array_elements(coalesce(p_carga->'ordenes', '[]'::jsonb)) x
  cross join lateral (select (x->>'id_orden')::bigint as id_orden) o
  cross join lateral jsonb_array_elements(coalesce(x->'lineas', '[]'::jsonb)) l
  where o.id_orden <> all (v_ids_omitidos)
  group by o.id_orden,
           (l->>'producto_id')::bigint,
           nullif(l->>'variacion_id', '')::bigint;

  get diagnostics v_lineas_insertadas = row_count;

  -- ---------------------------------------------------------------------
  -- 6. Resultado, también persistido en la fila de la carga.
  -- ---------------------------------------------------------------------
  update public.cargas
     set ordenes_nuevas     = v_ordenes_nuevas,
         ordenes_omitidas   = cardinality(v_ids_omitidos),
         productos_nuevos   = v_productos_despues - v_productos_antes,
         variaciones_nuevas = v_variaciones_desp - v_variaciones_antes
   where id = v_carga_id;

  return jsonb_build_object(
    'carga_id',           v_carga_id,
    'ordenes_nuevas',     v_ordenes_nuevas,
    'ordenes_omitidas',   cardinality(v_ids_omitidos),
    'ids_omitidos',       to_jsonb(v_ids_omitidos),
    'lineas_insertadas',  v_lineas_insertadas,
    'productos_nuevos',   v_productos_despues - v_productos_antes,
    'variaciones_nuevas', v_variaciones_desp - v_variaciones_antes
  );
end;
$$;

comment on function public.procesar_carga(jsonb) is
  'Persiste una carga completa de Dropi en una sola transacción, la registra en `cargas` y omite las órdenes ya existentes.';

revoke all on function public.procesar_carga(jsonb) from public;
revoke all on function public.procesar_carga(jsonb) from anon, authenticated;
grant execute on function public.procesar_carga(jsonb) to service_role;
