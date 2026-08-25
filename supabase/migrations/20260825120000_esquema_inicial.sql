-- ============================================================================
-- FULLEGACY — Esquema inicial
--
-- Modelo de datos de los pedidos exportados desde Dropi.
-- Los IDs de Dropi (PRODUCTO_ID, VARIACION_ID, ID de orden) se usan como
-- clave primaria directamente: son estables y globalmente únicos en Dropi,
-- lo que hace que el control de duplicados entre cargas sea un simple
-- `on conflict do nothing`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- productos
-- ---------------------------------------------------------------------------
create table if not exists public.productos (
  -- PRODUCTO_ID tal como viene del Excel de Dropi.
  id          bigint primary key,
  nombre      text   not null,
  creado_en   timestamptz not null default now()
);

comment on table  public.productos      is 'Productos de Dropi. El id es el PRODUCTO_ID del export.';
comment on column public.productos.id   is 'PRODUCTO_ID de Dropi (no autogenerado).';


-- ---------------------------------------------------------------------------
-- producto_variaciones
-- ---------------------------------------------------------------------------
create table if not exists public.producto_variaciones (
  -- VARIACION_ID tal como viene del Excel de Dropi.
  id                  bigint primary key,
  producto_id         bigint not null
                        references public.productos (id)
                        on update cascade
                        on delete restrict,
  sku                 text,
  texto_variacion     text,
  -- Unidades por variación deducidas del texto (ej. "x3" -> 3).
  -- Nullable: el parser (Sprint 1) puede no lograr extraerlas.
  unidades_extraidas  numeric,
  creado_en           timestamptz not null default now()
);

comment on table  public.producto_variaciones                    is 'Variaciones de producto de Dropi. El id es el VARIACION_ID del export.';
comment on column public.producto_variaciones.unidades_extraidas is 'Unidades deducidas del texto_variacion. NULL si no se pudieron extraer.';

-- Consulta típica: todas las variaciones de un producto.
create index if not exists producto_variaciones_producto_id_idx
  on public.producto_variaciones (producto_id);

-- Búsqueda por SKU (parcial: muchas variaciones pueden no traer SKU).
create index if not exists producto_variaciones_sku_idx
  on public.producto_variaciones (sku)
  where sku is not null;


-- ---------------------------------------------------------------------------
-- ordenes
-- ---------------------------------------------------------------------------
create table if not exists public.ordenes (
  -- ID de la orden tal como viene del Excel de Dropi. Clave del control
  -- de duplicados: si ya existe, la carga la omite.
  id_orden              bigint primary key,
  estado                text not null,
  fecha_orden           timestamptz not null,
  -- Nullable: una orden puede existir sin guía generada todavía.
  fecha_guia_generada   timestamptz,
  creado_en             timestamptz not null default now()
);

comment on table  public.ordenes                     is 'Órdenes de Dropi. El id_orden es el ID del export y garantiza el control de duplicados.';
comment on column public.ordenes.fecha_guia_generada is 'Fecha de generación de la guía. NULL si aún no tiene guía.';

-- El historial mensual se agrupa por día de despacho.
create index if not exists ordenes_fecha_guia_generada_idx
  on public.ordenes (fecha_guia_generada)
  where fecha_guia_generada is not null;

-- Reportes acotados por mes según la fecha real de la orden.
create index if not exists ordenes_fecha_orden_idx
  on public.ordenes (fecha_orden);

-- Los reportes filtran por estados válidos / excluidos.
create index if not exists ordenes_estado_idx
  on public.ordenes (estado);


-- ---------------------------------------------------------------------------
-- orden_productos
--
-- Una fila por (orden, variación). Varias filas para la misma orden
-- representan un combo: cada producto que lo compone se cuenta individualmente.
-- ---------------------------------------------------------------------------
create table if not exists public.orden_productos (
  id            bigint generated always as identity primary key,
  orden_id      bigint not null
                  references public.ordenes (id_orden)
                  on update cascade
                  on delete cascade,
  variacion_id  bigint not null
                  references public.producto_variaciones (id)
                  on update cascade
                  on delete restrict,
  cantidad      integer not null check (cantidad > 0),
  creado_en     timestamptz not null default now(),

  -- Una misma variación no se repite dentro de una orden: si el Excel la trae
  -- dos veces, la carga suma las cantidades en una sola fila. Esto permite
  -- reprocesar un archivo sin duplicar líneas.
  constraint orden_productos_orden_variacion_uniq unique (orden_id, variacion_id)
);

comment on table public.orden_productos is 'Líneas de una orden. Varias filas por orden = combo.';

create index if not exists orden_productos_orden_id_idx
  on public.orden_productos (orden_id);

-- Consulta típica de los reportes: unidades por producto en un rango de fechas.
create index if not exists orden_productos_variacion_id_idx
  on public.orden_productos (variacion_id);


-- ============================================================================
-- Row Level Security
--
-- Todo queda cerrado por defecto. Solo un usuario autenticado puede leer, y
-- el único que puede llegar a autenticarse es el correo autorizado (ver la
-- migración 20260825120100_restriccion_acceso.sql).
-- La escritura la hace el servidor con la service_role key, que salta RLS.
-- ============================================================================
alter table public.productos            enable row level security;
alter table public.producto_variaciones enable row level security;
alter table public.ordenes              enable row level security;
alter table public.orden_productos      enable row level security;

drop policy if exists "lectura_autenticado" on public.productos;
create policy "lectura_autenticado" on public.productos
  for select to authenticated using (true);

drop policy if exists "lectura_autenticado" on public.producto_variaciones;
create policy "lectura_autenticado" on public.producto_variaciones
  for select to authenticated using (true);

drop policy if exists "lectura_autenticado" on public.ordenes;
create policy "lectura_autenticado" on public.ordenes
  for select to authenticated using (true);

drop policy if exists "lectura_autenticado" on public.orden_productos;
create policy "lectura_autenticado" on public.orden_productos
  for select to authenticated using (true);
