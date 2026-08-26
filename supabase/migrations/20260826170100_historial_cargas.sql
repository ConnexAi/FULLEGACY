-- ============================================================================
-- FULLEGACY — Historial de cargas
--
-- Cada archivo que sube Diego deja una fila con su resumen, y cada orden queda
-- ligada a la carga que la trajo. Eso es lo que permite reconstruir después el
-- Reporte Ordenado de una carga puntual (Sprint 2), que por definición es "los
-- pedidos de ESE archivo", no un acumulado histórico.
-- ============================================================================

create table if not exists public.cargas (
  id                  bigint generated always as identity primary key,
  nombre_archivo      text        not null,
  creado_en           timestamptz not null default now(),
  -- Contadores del resultado. Los llena procesar_carga() al terminar.
  ordenes_nuevas      integer     not null default 0,
  ordenes_omitidas    integer     not null default 0,
  filas_leidas        integer     not null default 0,
  filas_con_error     integer     not null default 0,
  productos_nuevos    integer     not null default 0,
  variaciones_nuevas  integer     not null default 0
);

comment on table public.cargas is
  'Una fila por archivo procesado. Ligada a las órdenes que trajo vía ordenes.carga_id.';

-- El listado se muestra de la más reciente a la más vieja.
create index if not exists cargas_creado_en_idx
  on public.cargas (creado_en desc);

-- ---------------------------------------------------------------------------
-- Cada orden sabe de qué carga vino.
-- ---------------------------------------------------------------------------
alter table public.ordenes
  add column if not exists carga_id bigint;

alter table public.ordenes
  drop constraint if exists ordenes_carga_id_fkey;

alter table public.ordenes
  add constraint ordenes_carga_id_fkey
    foreign key (carga_id) references public.cargas (id)
    on update cascade
    on delete restrict;   -- borrar una carga no debe dejar órdenes huérfanas

-- Seguro: la tabla quedó vacía con el TRUNCATE de la migración anterior.
alter table public.ordenes
  alter column carga_id set not null;

comment on column public.ordenes.carga_id is
  'Carga que trajo esta orden. Base del Reporte Ordenado por archivo.';

create index if not exists ordenes_carga_id_idx
  on public.ordenes (carga_id);

-- ---------------------------------------------------------------------------
-- Acceso: el listado de /cargas lo lee el navegador con la sesión de Diego.
-- ---------------------------------------------------------------------------
alter table public.cargas enable row level security;

drop policy if exists "lectura_autenticado" on public.cargas;
create policy "lectura_autenticado" on public.cargas
  for select to authenticated using (true);

grant select on public.cargas to authenticated;
grant select, insert, update on public.cargas to service_role;
grant usage, select on all sequences in schema public to service_role;
