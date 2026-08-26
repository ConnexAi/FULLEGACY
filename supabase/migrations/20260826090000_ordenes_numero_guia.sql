-- ============================================================================
-- FULLEGACY — Sprint 1
-- Número de guía de la orden.
--
-- El Reporte Ordenado lo necesita para que Diego pueda cruzar el listado
-- contra las guías impresas. Es nullable: una orden sin guía generada
-- todavía no tiene número.
-- ============================================================================

alter table public.ordenes
  add column if not exists numero_guia text;

comment on column public.ordenes.numero_guia is
  'NÚMERO GUIA del export de Dropi. NULL si la orden aún no tiene guía.';

-- Búsqueda puntual por guía. Parcial: muchas órdenes no la traen.
create index if not exists ordenes_numero_guia_idx
  on public.ordenes (numero_guia)
  where numero_guia is not null;
