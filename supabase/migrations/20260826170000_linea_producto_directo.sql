-- ============================================================================
-- FULLEGACY — La línea de orden apunta al producto, la variación es opcional
--
-- El modelo original obligaba a que toda línea pasara por `producto_variaciones`.
-- Contra el export real de Dropi (1620 filas) eso descartó 448 filas y 446
-- órdenes: 18 de los 21 productos de Diego no tienen variantes configuradas y
-- vienen sin VARIACION ID. No es dato corrupto, es un producto sin variantes.
--
-- Ahora `producto_id` va siempre en la línea (que es como agrupan todos los
-- reportes) y `variacion_id` queda como lo que realmente es en Dropi: un
-- atributo opcional.
--
-- Los datos actuales son de una prueba parcial (1172 de 1618 órdenes), así que
-- se descartan y se re-ingesta desde cero.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Borrón y cuenta nueva. Las 4 tablas van en un solo TRUNCATE para que las FK
-- entre ellas no importen; RESTART IDENTITY reinicia orden_productos.id.
-- ---------------------------------------------------------------------------
truncate table
    public.orden_productos,
    public.ordenes,
    public.producto_variaciones,
    public.productos
  restart identity;

-- ---------------------------------------------------------------------------
-- SKU del producto.
--
-- Dropi manda SKU en todas las filas. Cuando el producto tiene variantes, el
-- SKU identifica la variante y vive en `producto_variaciones`. Cuando no las
-- tiene, es del producto y hasta ahora se perdía (18 de 21 productos).
-- ---------------------------------------------------------------------------
alter table public.productos
  add column if not exists sku text;

comment on column public.productos.sku is
  'SKU de Dropi para productos sin variantes. NULL si el producto maneja variaciones (ahí el SKU vive en producto_variaciones).';

-- ---------------------------------------------------------------------------
-- Clave compuesta para poder referenciar el par (variación, producto).
-- Es lo que hace imposible que una línea diga "producto A, variación de B".
-- ---------------------------------------------------------------------------
alter table public.producto_variaciones
  drop constraint if exists producto_variaciones_id_producto_id_key;

alter table public.producto_variaciones
  add constraint producto_variaciones_id_producto_id_key
    unique (id, producto_id);

-- ---------------------------------------------------------------------------
-- orden_productos: producto_id obligatorio, variacion_id opcional
-- ---------------------------------------------------------------------------
alter table public.orden_productos
  add column if not exists producto_id bigint;

-- Seguro: la tabla quedó vacía con el TRUNCATE de arriba.
alter table public.orden_productos
  alter column producto_id set not null;

alter table public.orden_productos
  alter column variacion_id drop not null;

alter table public.orden_productos
  drop constraint if exists orden_productos_producto_id_fkey;

alter table public.orden_productos
  add constraint orden_productos_producto_id_fkey
    foreign key (producto_id) references public.productos (id)
    on update cascade
    on delete restrict;

-- La FK simple a la variación se reemplaza por la compuesta. Con MATCH SIMPLE
-- (el default), si variacion_id es NULL la restricción no se evalúa: es
-- exactamente el comportamiento que queremos para un producto sin variantes.
alter table public.orden_productos
  drop constraint if exists orden_productos_variacion_id_fkey;

alter table public.orden_productos
  drop constraint if exists orden_productos_variacion_producto_fkey;

alter table public.orden_productos
  add constraint orden_productos_variacion_producto_fkey
    foreign key (variacion_id, producto_id)
      references public.producto_variaciones (id, producto_id)
    on update cascade
    on delete restrict;

-- ---------------------------------------------------------------------------
-- Deduplicación.
--
-- NULLS NOT DISTINCT (Postgres 15+) hace que dos líneas sin variación para el
-- mismo producto cuenten como duplicadas y se sumen, en vez de colarse dos
-- veces por ser NULL != NULL.
-- ---------------------------------------------------------------------------
alter table public.orden_productos
  drop constraint if exists orden_productos_orden_variacion_uniq;

alter table public.orden_productos
  drop constraint if exists orden_productos_orden_producto_variacion_uniq;

alter table public.orden_productos
  add constraint orden_productos_orden_producto_variacion_uniq
    unique nulls not distinct (orden_id, producto_id, variacion_id);

comment on column public.orden_productos.variacion_id is
  'Variación de Dropi. NULL cuando el producto no maneja variantes.';

-- Los reportes agrupan por producto: este índice es el que más se usa.
create index if not exists orden_productos_producto_id_idx
  on public.orden_productos (producto_id);
