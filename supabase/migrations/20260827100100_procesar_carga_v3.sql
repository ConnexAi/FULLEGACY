-- ============================================================================
-- FULLEGACY — procesar_carga() v3
--
-- Persiste además `transportadora` y `ciudad_destino` de la orden, y la
-- posición `linea` de cada producto dentro de la orden (orden del archivo),
-- que el Reporte Ordenado necesita para anclar los combos.
--
-- El resto es idéntico a la versión anterior: validación del contrato de
-- entrada, registro en `cargas`, control de duplicados y una sola transacción.
-- ============================================================================

create or replace function public.procesar_carga(p_carga jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_carga_id           bigint;
  v_lineas_sin_prod    bigint   := 0;
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
  -- 4. Control de duplicados.
  -- ---------------------------------------------------------------------
  select coalesce(array_agg(distinct (x->>'id_orden')::bigint), '{}')
    into v_ids_entrada
  from jsonb_array_elements(coalesce(p_carga->'ordenes', '[]'::jsonb)) x;

  select coalesce(array_agg(o.id_orden), '{}')
    into v_ids_omitidos
  from public.ordenes o
  where o.id_orden = any (v_ids_entrada);

  -- ---------------------------------------------------------------------
  -- 5. Órdenes nuevas, atadas a esta carga.
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
  where o.id_orden <> all (v_ids_omitidos)
  order by o.id_orden;

  get diagnostics v_ordenes_nuevas = row_count;

  -- ---------------------------------------------------------------------
  -- 6. Líneas. producto_id siempre; variacion_id solo si el producto la maneja.
  -- ---------------------------------------------------------------------
  -- `linea` conserva la posición en el archivo. Si dos filas se fusionan por
  -- ser el mismo (producto, variación), gana la posición más temprana.
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
  where o.id_orden <> all (v_ids_omitidos)
  group by o.id_orden,
           (l->>'producto_id')::bigint,
           nullif(l->>'variacion_id', '')::bigint;

  get diagnostics v_lineas_insertadas = row_count;

  -- ---------------------------------------------------------------------
  -- 7. Resultado.
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

revoke all on function public.procesar_carga(jsonb) from public;
revoke all on function public.procesar_carga(jsonb) from anon, authenticated;
grant execute on function public.procesar_carga(jsonb) to service_role;
