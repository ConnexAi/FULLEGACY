-- ============================================================================
-- FULLEGACY — Foto de cada carga: qué traía el archivo tal como se subió
--
-- El Reporte Ordenado sale hoy de `ordenes.carga_id`, y ese campo se muda a la
-- carga más nueva cuando una orden se actualiza (la "opción B", ya en
-- producción). Eso es correcto para responder "qué está pendiente ahora
-- mismo", y no cambia.
--
-- Pero tiene una consecuencia: el reporte de una carga vieja se va vaciando
-- solo, porque sus órdenes se mudan a la carga que las actualizó después. No
-- hay forma de ver qué traía exactamente el archivo que se subió tal día, con
-- los datos de ese momento.
--
-- Esta tabla lo resuelve. Es de SOLA INSERCIÓN: cada carga deja una fila por
-- cada orden que venía en su archivo, con los datos tal como venían en ese
-- archivo. Nunca se actualiza después. Que una orden cambie más adelante no
-- toca las fotos ya tomadas.
--
-- Dos propiedades que la hacen útil:
--
--   - Los datos salen del JSON del archivo, no de la tabla `ordenes`. Por eso
--     la foto es del archivo y no del estado ya actualizado.
--   - Quedan registradas también las órdenes cuya fila se ignoró por venir
--     desactualizada (ver 20260924220000). Es justamente donde más aporta: hoy
--     un archivo viejo no deja ningún rastro de qué decía.
--
-- Lo que NO se fotografía son las líneas de producto. `orden_productos` nunca
-- se actualiza, así que las líneas guardadas son las originales y alcanza con
-- unirse a ellas. Límite conocido: si un archivo trajera líneas distintas a
-- las guardadas (por una fila con error de parseo), la foto mostraría las
-- guardadas. Nunca ocurrió — `filas_con_error` es 0 en todas las cargas — y
-- fotografiar las líneas duplicaría la tabla por un caso que no existe.
-- ============================================================================

create table if not exists public.carga_ordenes_foto (
  carga_id            bigint      not null
                        references public.cargas (id) on delete cascade,
  -- Cascada a propósito: si una orden se borrara, `orden_productos` también se
  -- va en cascada, y la foto quedaría sin líneas con qué unirse — una foto
  -- rota es peor que no tenerla.
  id_orden            bigint      not null
                        references public.ordenes (id_orden)
                        on update cascade on delete cascade,
  estado              text        not null,
  fecha_orden         timestamptz not null,
  fecha_guia_generada timestamptz,
  numero_guia         text,
  transportadora      text,
  ciudad_destino      text,
  -- Qué hizo el sistema con esta orden en esta carga. Convierte la tabla en
  -- bitácora: permite reconstruir por qué una orden quedó como quedó.
  tipo                text        not null
                        check (tipo in ('nueva', 'actualizada',
                                        'sin_cambios', 'desactualizada')),
  creado_en           timestamptz not null default now(),

  -- La clave compuesta alcanza: nada referencia esta tabla, y además garantiza
  -- que una orden no pueda aparecer dos veces en la foto de la misma carga.
  primary key (carga_id, id_orden)
);

comment on table public.carga_ordenes_foto is
  'Foto inmutable de las órdenes que traía cada archivo, con sus datos de ese momento. Solo inserción.';
comment on column public.carga_ordenes_foto.tipo is
  'Qué hizo esta carga con la orden: nueva, actualizada, sin_cambios o desactualizada (fila ignorada por traer menos información de la que ya teníamos).';

-- El PK ya cubre "todas las órdenes de esta carga" (carga_id va primero).
-- Este índice es para la pregunta inversa: en qué archivos apareció una orden
-- y cómo venía en cada uno.
create index if not exists carga_ordenes_foto_orden_idx
  on public.carga_ordenes_foto (id_orden);

-- ---------------------------------------------------------------------------
-- Vista histórica, con exactamente las mismas columnas que `v_lineas_carga`.
--
-- Esa simetría es deliberada: `construirReporteOrdenado()` no se entera de
-- dónde salen las líneas, así que la pantalla y el Excel reutilizan la misma
-- lógica de armado cambiando solo el origen.
-- ---------------------------------------------------------------------------
drop view if exists public.v_lineas_carga_foto;

create view public.v_lineas_carga_foto
  with (security_invoker = true)
as
select
  f.carga_id,
  f.id_orden,
  f.estado,
  upper(btrim(f.estado))            as estado_normalizado,
  f.numero_guia,
  f.transportadora,
  f.ciudad_destino,
  f.fecha_orden,
  f.fecha_guia_generada,
  op.linea,
  op.producto_id,
  p.nombre                          as producto_nombre,
  op.variacion_id,
  pv.texto_variacion,
  pv.unidades_extraidas,
  op.cantidad
from public.carga_ordenes_foto f
  join public.orden_productos op     on op.orden_id = f.id_orden
  join public.productos p            on p.id = op.producto_id
  left join public.producto_variaciones pv on pv.id = op.variacion_id;

comment on view public.v_lineas_carga_foto is
  'Como v_lineas_carga, pero con los datos de la orden tal como venían en el archivo de esa carga.';

alter table public.carga_ordenes_foto enable row level security;

drop policy if exists "lectura_autenticado" on public.carga_ordenes_foto;
create policy "lectura_autenticado" on public.carga_ordenes_foto
  for select to authenticated using (true);

grant select on public.carga_ordenes_foto to authenticated;
grant select, insert on public.carga_ordenes_foto to service_role;
grant select on public.v_lineas_carga_foto to authenticated, service_role;

-- ============================================================================
-- procesar_carga() v6: además de persistir, deja la foto de la carga.
--
-- Cambios respecto de la v5:
--
--   - El UPDATE de repetidas pasa de `get diagnostics` a `with ... returning`,
--     para saber CUÁLES órdenes cambiaron y no solo cuántas. Eso alimenta el
--     campo `tipo`.
--   - Paso nuevo: la foto. Va después de insertar las órdenes nuevas porque la
--     tabla tiene FK contra `ordenes` — una orden nueva todavía no existe
--     cuando corre el UPDATE de repetidas. Los `tipo` se calculan con arrays
--     capturados antes, así que la posición no los afecta.
-- ============================================================================

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
  v_ids_desactualizados  bigint[] := '{}';
  v_ids_actualizados     bigint[] := '{}';
  v_ordenes_nuevas       bigint   := 0;
  v_ordenes_actualizadas bigint   := 0;
  v_ordenes_sin_cambios  bigint   := 0;
  v_lineas_insertadas    bigint   := 0;
  v_filas_foto           bigint   := 0;
  v_productos_antes      bigint   := 0;
  v_productos_despues    bigint   := 0;
  v_variaciones_antes    bigint   := 0;
  v_variaciones_desp     bigint   := 0;
begin
  -- ---------------------------------------------------------------------
  -- 0. Contrato: toda línea debe traer producto_id.
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
  -- 4b. Cuáles de esas filas vienen desactualizadas.
  --
  -- La orden ya tiene fecha de guía guardada y el archivo la trae sin ella:
  -- es un archivo anterior al despacho. Se calcula ANTES de actualizar nada,
  -- porque se compara contra lo que hay hoy en la base.
  -- ---------------------------------------------------------------------
  select coalesce(array_agg(d.id_orden), '{}')
    into v_ids_desactualizados
  from (
    select distinct on ((x->>'id_orden')::bigint)
           (x->>'id_orden')::bigint                           as id_orden,
           nullif(x->>'fecha_guia_generada', '')::timestamptz as fecha_guia_generada
    from jsonb_array_elements(coalesce(p_carga->'ordenes', '[]'::jsonb)) x
    order by (x->>'id_orden')::bigint
  ) d
  join public.ordenes o on o.id_orden = d.id_orden
  where o.fecha_guia_generada is not null
    and d.fecha_guia_generada is null;

  -- ---------------------------------------------------------------------
  -- 5. Órdenes repetidas: se actualizan con lo que trae el archivo nuevo.
  --
  -- Va ANTES de insertar las nuevas a propósito: así este UPDATE solo puede
  -- alcanzar filas que ya estaban, y no las que se acaban de crear.
  --
  -- El `returning` (en vez de `get diagnostics`) da los ids concretos, que la
  -- foto necesita para marcar cuáles quedaron como 'actualizada'.
  -- ---------------------------------------------------------------------
  with cambiadas as (
    update public.ordenes o
       set estado              = n.estado,
           fecha_orden         = n.fecha_orden,
           -- Segunda línea de defensa: con la regla de filas desactualizadas,
           -- un archivo viejo ya ni siquiera llega acá.
           fecha_guia_generada = coalesce(n.fecha_guia_generada, o.fecha_guia_generada),
           -- Este sí sigue trabajando: un archivo puede traer la fecha de guía
           -- pero no el número, y ahí conservamos el que ya teníamos.
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
     and o.id_orden <> all (v_ids_desactualizados)
     and (o.estado, o.fecha_orden, o.fecha_guia_generada,
          o.numero_guia, o.transportadora, o.ciudad_destino)
         is distinct from
         (n.estado, n.fecha_orden,
          coalesce(n.fecha_guia_generada, o.fecha_guia_generada),
          coalesce(n.numero_guia, o.numero_guia),
          n.transportadora, n.ciudad_destino)
   returning o.id_orden
  )
  select coalesce(array_agg(id_orden), '{}')
    into v_ids_actualizados
  from cambiadas;

  v_ordenes_actualizadas := cardinality(v_ids_actualizados);

  -- Las ignoradas por desactualizadas caen acá: en la base no cambió nada.
  v_ordenes_sin_cambios := cardinality(v_ids_existentes) - v_ordenes_actualizadas;

  -- ---------------------------------------------------------------------
  -- 6. Toda orden repetida se muda a la carga nueva, haya cambiado o no.
  --
  -- Las desactualizadas quedan afuera: un archivo viejo tampoco puede
  -- reclamar la orden para su carga.
  -- ---------------------------------------------------------------------
  update public.ordenes
     set carga_id = v_carga_id
   where id_orden = any (v_ids_existentes)
     and id_orden <> all (v_ids_desactualizados);

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
  -- 8. La foto de esta carga.
  --
  -- Los datos salen del JSON del archivo, NO de la tabla `ordenes`: es la foto
  -- de lo que traía el archivo, no del estado ya actualizado. Por eso las
  -- órdenes ignoradas por desactualizadas quedan igual registradas, con lo que
  -- decía el archivo.
  --
  -- Va después del paso 7 porque la tabla tiene FK contra `ordenes`: una orden
  -- nueva todavía no existe antes de ese insert.
  --
  -- El `distinct on` protege el PK compuesto: si el payload trajera dos veces
  -- la misma orden, sin esto la carga entera abortaría.
  -- ---------------------------------------------------------------------
  insert into public.carga_ordenes_foto
    (carga_id, id_orden, estado, fecha_orden, fecha_guia_generada,
     numero_guia, transportadora, ciudad_destino, tipo)
  select distinct on (f.id_orden)
         v_carga_id, f.id_orden, f.estado, f.fecha_orden, f.fecha_guia_generada,
         f.numero_guia, f.transportadora, f.ciudad_destino, f.tipo
  from (
    select (x->>'id_orden')::bigint                            as id_orden,
           x->>'estado'                                        as estado,
           (x->>'fecha_orden')::timestamptz                    as fecha_orden,
           nullif(x->>'fecha_guia_generada', '')::timestamptz  as fecha_guia_generada,
           nullif(trim(x->>'numero_guia'), '')                 as numero_guia,
           nullif(trim(x->>'transportadora'), '')              as transportadora,
           nullif(trim(x->>'ciudad_destino'), '')              as ciudad_destino,
           case
             when (x->>'id_orden')::bigint <> all (v_ids_existentes)
               then 'nueva'
             when (x->>'id_orden')::bigint = any (v_ids_desactualizados)
               then 'desactualizada'
             when (x->>'id_orden')::bigint = any (v_ids_actualizados)
               then 'actualizada'
             else 'sin_cambios'
           end                                                 as tipo
    from jsonb_array_elements(coalesce(p_carga->'ordenes', '[]'::jsonb)) x
  ) f
  order by f.id_orden;

  get diagnostics v_filas_foto = row_count;

  -- ---------------------------------------------------------------------
  -- 9. Líneas, solo de las órdenes nuevas.
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
  -- 10. Resultado.
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
    'ids_desactualizados',  to_jsonb(v_ids_desactualizados),
    'lineas_insertadas',    v_lineas_insertadas,
    'filas_foto',           v_filas_foto,
    'productos_nuevos',     v_productos_despues - v_productos_antes,
    'variaciones_nuevas',   v_variaciones_desp - v_variaciones_antes
  );
end;
$$;

comment on function public.procesar_carga(jsonb) is
  'Persiste una carga de Dropi en una sola transacción, deja su foto en carga_ordenes_foto, y actualiza las órdenes repetidas salvo que la fila venga desactualizada.';

revoke all on function public.procesar_carga(jsonb) from public;
revoke all on function public.procesar_carga(jsonb) from anon, authenticated;
grant execute on function public.procesar_carga(jsonb) to service_role;
