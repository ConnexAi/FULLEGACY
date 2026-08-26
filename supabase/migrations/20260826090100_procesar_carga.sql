-- ============================================================================
-- FULLEGACY — Sprint 1
-- Ingesta transaccional de una carga (un archivo de Dropi).
--
-- Todo el guardado ocurre dentro de esta función, que Postgres ejecuta como
-- una única transacción: o queda el archivo completo, o no queda nada.
-- Hacerlo desde el cliente con llamadas sueltas no daría esa garantía, porque
-- supabase-js no expone BEGIN/COMMIT.
--
-- La app ya llega aquí con las filas parseadas, validadas y agrupadas por
-- orden. Esta función no interpreta el Excel: solo persiste.
--
-- Estructura esperada de p_carga:
--   {
--     "productos":   [ { "id": 2105813, "nombre": "Hydra" } ],
--     "variaciones": [ { "id": 2109232, "producto_id": 2105813, "sku": "463830-0",
--                        "texto_variacion": "1 unidad", "unidades_extraidas": 1 } ],
--     "ordenes":     [ { "id_orden": 123, "estado": "ENTREGADO",
--                        "fecha_orden": "2026-04-03T15:30:00Z",
--                        "fecha_guia_generada": null, "numero_guia": "240012345",
--                        "lineas": [ { "variacion_id": 2109232, "cantidad": 1 } ] } ]
--   }
-- ============================================================================

create or replace function public.procesar_carga(p_carga jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
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
  -- 1. Catálogo: productos.
  --
  -- Se auto-registra desde lo que traiga el archivo; no hay catálogo
  -- precargado. Dropi es la fuente de verdad del nombre, así que un archivo
  -- nuevo puede corregir el nombre de un producto ya conocido.
  -- ---------------------------------------------------------------------
  select count(*) into v_productos_antes from public.productos;

  insert into public.productos (id, nombre)
  select distinct on (p.id) p.id, p.nombre
  from (
    select (x->>'id')::bigint as id,
           coalesce(nullif(trim(x->>'nombre'), ''), 'Producto ' || (x->>'id')) as nombre
    from jsonb_array_elements(coalesce(p_carga->'productos', '[]'::jsonb)) x
  ) p
  order by p.id
  on conflict (id) do update
    set nombre = excluded.nombre;

  select count(*) into v_productos_despues from public.productos;

  -- ---------------------------------------------------------------------
  -- 2. Catálogo: variaciones.
  --
  -- Va después de productos porque producto_id es FK. Al ser sentencias
  -- separadas dentro de la misma transacción, el orden está garantizado.
  --
  -- `unidades_extraidas` se conserva si la carga nueva no logró extraerla:
  -- un texto de variación que un archivo no pudo parsear no debe borrar el
  -- valor bueno que dejó un archivo anterior.
  -- ---------------------------------------------------------------------
  select count(*) into v_variaciones_antes from public.producto_variaciones;

  insert into public.producto_variaciones
    (id, producto_id, sku, texto_variacion, unidades_extraidas)
  select distinct on (v.id)
         v.id, v.producto_id, v.sku, v.texto_variacion, v.unidades_extraidas
  from (
    select (x->>'id')::bigint                          as id,
           (x->>'producto_id')::bigint                 as producto_id,
           nullif(trim(x->>'sku'), '')                 as sku,
           nullif(trim(x->>'texto_variacion'), '')     as texto_variacion,
           (x->>'unidades_extraidas')::numeric         as unidades_extraidas
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
  -- 3. Control de duplicados.
  --
  -- Se resuelve antes de insertar nada de órdenes: los ids que ya existen
  -- se omiten por completo (ni se actualiza la orden ni se tocan sus líneas).
  -- ---------------------------------------------------------------------
  select coalesce(array_agg(distinct (x->>'id_orden')::bigint), '{}')
    into v_ids_entrada
  from jsonb_array_elements(coalesce(p_carga->'ordenes', '[]'::jsonb)) x;

  select coalesce(array_agg(o.id_orden), '{}')
    into v_ids_omitidos
  from public.ordenes o
  where o.id_orden = any (v_ids_entrada);

  -- ---------------------------------------------------------------------
  -- 4. Órdenes nuevas.
  -- ---------------------------------------------------------------------
  insert into public.ordenes
    (id_orden, estado, fecha_orden, fecha_guia_generada, numero_guia)
  select distinct on (o.id_orden)
         o.id_orden, o.estado, o.fecha_orden, o.fecha_guia_generada, o.numero_guia
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
  -- 5. Líneas de las órdenes nuevas (una por producto → así se guardan los combos).
  --
  -- El group by cubre el unique (orden_id, variacion_id): si el archivo trae
  -- dos veces la misma variación en la misma orden, las cantidades se suman
  -- en lugar de reventar por duplicado.
  -- ---------------------------------------------------------------------
  insert into public.orden_productos (orden_id, variacion_id, cantidad)
  select o.id_orden,
         (l->>'variacion_id')::bigint,
         sum((l->>'cantidad')::integer)
  from jsonb_array_elements(coalesce(p_carga->'ordenes', '[]'::jsonb)) x
  cross join lateral (select (x->>'id_orden')::bigint as id_orden) o
  cross join lateral jsonb_array_elements(coalesce(x->'lineas', '[]'::jsonb)) l
  where o.id_orden <> all (v_ids_omitidos)
  group by o.id_orden, (l->>'variacion_id')::bigint;

  get diagnostics v_lineas_insertadas = row_count;

  return jsonb_build_object(
    'ordenes_nuevas',         v_ordenes_nuevas,
    'ordenes_omitidas',       cardinality(v_ids_omitidos),
    'ids_omitidos',           to_jsonb(v_ids_omitidos),
    'lineas_insertadas',      v_lineas_insertadas,
    'productos_nuevos',       v_productos_despues - v_productos_antes,
    'variaciones_nuevas',     v_variaciones_desp - v_variaciones_antes
  );
end;
$$;

comment on function public.procesar_carga(jsonb) is
  'Persiste una carga completa de Dropi en una sola transacción. Omite las órdenes cuyo id ya existe.';

-- Solo el servidor (service_role) puede invocarla. El navegador nunca.
revoke all on function public.procesar_carga(jsonb) from public;
revoke all on function public.procesar_carga(jsonb) from anon, authenticated;
grant execute on function public.procesar_carga(jsonb) to service_role;
