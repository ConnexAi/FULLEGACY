/**
 * Reporte Ordenado, de punta a punta: procesar_carga() → v_lineas_carga →
 * construirReporteOrdenado().
 *
 * pruebas/reporte-ordenado.test.mts ya prueba `construirReporteOrdenado` en
 * aislamiento, con objetos `LineaCarga` armados a mano. Este archivo cierra el
 * hueco real: los dos combos que existen en datos reales de Dropi son 1+1
 * (una unidad de cada producto), así que el camino "combo con cantidades
 * distintas de 1 por componente" nunca se había probado contra la base de
 * datos real — solo contra la función pura. Acá se ejercita el pipeline
 * completo tal como lo usa la app: la misma llamada RPC, la misma vista, la
 * misma función de armado.
 */
import { readFileSync } from "node:fs";

import { PGlite } from "@electric-sql/pglite";

import {
  construirReporteOrdenado,
  type LineaCarga,
} from "@/lib/reportes/reporte-ordenado";

const RAIZ = new URL("..", import.meta.url).pathname;
const MIGRACIONES = [
  "20260825120000_esquema_inicial.sql",
  "20260825120100_restriccion_acceso.sql",
  "20260826090000_ordenes_numero_guia.sql",
  "20260826090100_procesar_carga.sql",
  "20260826150000_privilegios_tablas.sql",
  "20260826170000_linea_producto_directo.sql",
  "20260826170100_historial_cargas.sql",
  "20260826170200_procesar_carga_v2.sql",
  "20260826190000_procesar_carga_contrato.sql",
  "20260827100000_reporte_ordenado_datos.sql",
  "20260827100100_procesar_carga_v3.sql",
  "20260908100000_historial_mensual.sql",
  "20260914100000_totales_diarios.sql",
  "20260915100000_historial_mensual_por_producto.sql",
  "20260924210000_actualizar_ordenes_repetidas.sql",
  "20260924220000_ignorar_filas_desactualizadas.sql",
];

// PGlite vuelca todo su bundle en el stack: sobra ruido para leer un fallo.
process.on("uncaughtException", (e) => {
  console.error("\nERROR:", (e as Error).message);
  process.exit(1);
});

let fallos = 0;
function check(nombre: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos += 1;
  console.log(
    `${ok ? "  ok  " : "FALLA"} ${nombre}` +
      (ok
        ? ""
        : `\n        esperado: ${JSON.stringify(esperado)}\n        real:     ${JSON.stringify(real)}`),
  );
}

const db = await PGlite.create();

await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
`);

for (const archivo of MIGRACIONES) {
  await db.exec(readFileSync(`${RAIZ}supabase/migrations/${archivo}`, "utf8"));
}
console.log(`las ${MIGRACIONES.length} migraciones aplicaron\n`);

/* -------------------------------------------------------------------------- */
console.log("── Carga: combos con cantidades reales por componente ──");

const carga = {
  archivo: { nombre: "combos-cantidades.xlsx", filas_leidas: 0, filas_con_error: 0 },
  productos: [
    { id: 1, nombre: "Hydra", sku: null },
    { id: 2, nombre: "Waggy pet", sku: "SKU-WP" },
    { id: 3, nombre: "Focus men", sku: null },
    { id: 4, nombre: "Dije Carmen", sku: "SKU-DC" },
    { id: 5, nombre: "Pulsera vancleef", sku: "SKU-PV" },
  ],
  variaciones: [],
  ordenes: [
    // El caso exacto que pidió Diego: 3 Hydra + 2 Waggy pet, en una orden.
    {
      id_orden: 5001, estado: "PENDIENTE", fecha_orden: "2026-09-01T12:00:00Z",
      fecha_guia_generada: null, numero_guia: null,
      lineas: [
        { producto_id: 1, variacion_id: null, cantidad: 3, linea: 1 },
        { producto_id: 2, variacion_id: null, cantidad: 2, linea: 2 },
      ],
    },
    // Combo de tres componentes, cantidades distintas entre sí — para no
    // quedarse solo en el caso de dos productos.
    {
      id_orden: 5002, estado: "PENDIENTE", fecha_orden: "2026-09-01T12:05:00Z",
      fecha_guia_generada: null, numero_guia: null,
      lineas: [
        { producto_id: 1, variacion_id: null, cantidad: 1, linea: 1 },
        { producto_id: 2, variacion_id: null, cantidad: 4, linea: 2 },
        { producto_id: 3, variacion_id: null, cantidad: 2, linea: 3 },
      ],
    },
    // El combo tal como existe hoy en los datos reales de Dropi: 1+1. Tiene
    // que seguir funcionando exactamente igual que antes de este ajuste.
    {
      id_orden: 5003, estado: "PENDIENTE", fecha_orden: "2026-09-01T12:10:00Z",
      fecha_guia_generada: null, numero_guia: null,
      lineas: [
        { producto_id: 4, variacion_id: null, cantidad: 1, linea: 1 },
        { producto_id: 5, variacion_id: null, cantidad: 1, linea: 2 },
      ],
    },
    // Orden normal (un solo producto), de control: no debe verse afectada.
    {
      id_orden: 5004, estado: "PENDIENTE", fecha_orden: "2026-09-01T12:15:00Z",
      fecha_guia_generada: null, numero_guia: null,
      lineas: [{ producto_id: 1, variacion_id: null, cantidad: 7, linea: 1 }],
    },
  ],
};

const resultado = (await db.query<{
  r: { carga_id: number; ordenes_nuevas: number; ordenes_sin_cambios: number };
}>(
  "select public.procesar_carga($1::jsonb) as r",
  [JSON.stringify(carga)],
)).rows[0].r;

check("las 4 órdenes entraron como nuevas", resultado.ordenes_nuevas, 4);
check("ninguna repetida", resultado.ordenes_sin_cambios, 0);
const cargaId = resultado.carga_id;

// Esto es lo que hace `obtenerCargaConReporte` en producción: la misma
// vista, el mismo filtro por prefijo de estado.
const lineas = (await db.query<LineaCarga>(
  `select carga_id, id_orden, estado, estado_normalizado, numero_guia,
          transportadora, ciudad_destino, linea, producto_id, producto_nombre,
          variacion_id, texto_variacion, unidades_extraidas, cantidad::int as cantidad
     from v_lineas_carga
    where carga_id = $1 and estado_normalizado like 'PENDIENTE%'
    order by id_orden, linea`,
  [cargaId],
)).rows.map((l) => ({
  ...l,
  id_orden: Number(l.id_orden),
  producto_id: Number(l.producto_id),
  variacion_id: l.variacion_id === null ? null : Number(l.variacion_id),
  unidades_extraidas: l.unidades_extraidas === null ? null : Number(l.unidades_extraidas),
}));

check("la vista trae las 9 líneas (2+3+2+1+1 de las cuatro órdenes)",
  lineas.length, 2 + 3 + 2 + 1);

const reporte = construirReporteOrdenado(lineas);

/* -------------------------------------------------------------------------- */
console.log("\n── Combo 3+2: una sola fila, con las cantidades reales ──");

const fila5001 = reporte.filas.find((f) => f.idOrden === 5001);
check("existe la fila del combo 5001", Boolean(fila5001), true);
check("es TIPO COMBO", fila5001?.tipo, "COMBO");
check(
  "PRODUCTO muestra las cantidades reales, no (1) fijo",
  fila5001?.producto,
  "COMBO · Hydra (3) + Waggy pet (2)",
);
check("CANTIDAD del combo = 1 (un pedido a preparar)", fila5001?.cantidad, 1);
check(
  "el combo ocupa una sola fila del reporte (no dos)",
  reporte.filas.filter((f) => f.idOrden === 5001).length,
  1,
);

console.log("\n── Combo de tres componentes ──");
const fila5002 = reporte.filas.find((f) => f.idOrden === 5002);
check(
  "PRODUCTO lista los tres, cada uno con su cantidad real",
  fila5002?.producto,
  "COMBO · Hydra (1) + Waggy pet (4) + Focus men (2)",
);
check("CANTIDAD sigue siendo 1", fila5002?.cantidad, 1);

console.log("\n── El combo 1+1 real (Dropi) no se rompe ──");
const fila5003 = reporte.filas.find((f) => f.idOrden === 5003);
check(
  "PRODUCTO sigue mostrando (1) + (1), igual que siempre",
  fila5003?.producto,
  "COMBO · Dije Carmen (1) + Pulsera vancleef (1)",
);
check("CANTIDAD = 1", fila5003?.cantidad, 1);

console.log("\n── La orden normal no se ve afectada ──");
const fila5004 = reporte.filas.find((f) => f.idOrden === 5004);
check("TIPO NORMAL", fila5004?.tipo, "NORMAL");
check("PRODUCTO es solo el nombre, sin cantidades entre paréntesis", fila5004?.producto, "Hydra");
check("CANTIDAD refleja la cantidad real del producto (7)", fila5004?.cantidad, 7);

/* -------------------------------------------------------------------------- */
console.log("\n── Conteo por producto: cada componente del combo cuenta su cantidad real ──");

// Hydra aparece en las 4 órdenes: 3 (combo 5001) + 1 (combo 5002) + 7 (normal 5004) = 11.
const hydra = reporte.conteoPorProducto.find((c) => c.producto === "Hydra");
check("Hydra: 3 pedidos, 11 unidades (3+1+7, no 1+1+1)", hydra, {
  producto: "Hydra", pedidos: 3, unidades: 11,
});

// Waggy pet aparece en los combos 5001 (2) y 5002 (4) = 6, en 2 pedidos.
const waggy = reporte.conteoPorProducto.find((c) => c.producto === "Waggy pet");
check("Waggy pet: 2 pedidos, 6 unidades (2+4, no 1+1)", waggy, {
  producto: "Waggy pet", pedidos: 2, unidades: 6,
});

// Focus men solo en el combo 5002, con cantidad 2.
const focus = reporte.conteoPorProducto.find((c) => c.producto === "Focus men");
check("Focus men: 1 pedido, 2 unidades (no 1)", focus, {
  producto: "Focus men", pedidos: 1, unidades: 2,
});

// Dije Carmen y Pulsera vancleef: el combo 1+1 de siempre.
check(
  "Dije Carmen y Pulsera vancleef: 1 pedido, 1 unidad cada uno",
  reporte.conteoPorProducto.filter((c) =>
    c.producto === "Dije Carmen" || c.producto === "Pulsera vancleef",
  ),
  [
    { producto: "Dije Carmen", pedidos: 1, unidades: 1 },
    { producto: "Pulsera vancleef", pedidos: 1, unidades: 1 },
  ],
);

check(
  "totales del reporte: 4 pedidos, 21 unidades (5+7+2+7)",
  [reporte.totalPedidos, reporte.totalUnidades],
  [4, 21],
);

console.log(`\n${fallos === 0 ? "REPORTE ORDENADO (DB → vista → función), COMBOS CORRECTOS" : `${fallos} FALLOS`}`);
process.exit(fallos ? 1 : 0);
