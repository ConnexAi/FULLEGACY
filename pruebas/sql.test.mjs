/**
 * Ejecuta las migraciones reales del proyecto sobre un Postgres 18 en WASM
 * y verifica el comportamiento de procesar_carga(): duplicados, combos,
 * variación repetida y auto-registro de catálogo.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const RAIZ = new URL("..", import.meta.url).pathname;
const MIGRACIONES = [
  "20260825120000_esquema_inicial.sql",
  "20260826090000_ordenes_numero_guia.sql",
  "20260826090100_procesar_carga.sql",
];

let fallos = 0;
function check(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos += 1;
  console.log(`${ok ? "  ok  " : "FALLA"} ${nombre}${ok ? "" : `\n        esperado: ${JSON.stringify(esperado)}\n        real:     ${JSON.stringify(real)}`}`);
}

const db = await PGlite.create();

// Roles que existen en Supabase pero no en un Postgres pelado.
await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role;
`);

for (const archivo of MIGRACIONES) {
  const sql = readFileSync(`${RAIZ}supabase/migrations/${archivo}`, "utf8");
  await db.exec(sql);
  console.log(`migración aplicada: ${archivo}`);
}
console.log();

const procesar = async (carga) =>
  (await db.query("select public.procesar_carga($1::jsonb) as r", [JSON.stringify(carga)]))
    .rows[0].r;

/* ------------------------------------------------------------------ */
console.log("── Carga 1: dos órdenes simples + un combo ──");

const carga1 = {
  productos: [
    { id: 2105813, nombre: "Hydra" },
    { id: 2174950, nombre: "Focus men" },
  ],
  variaciones: [
    { id: 2109232, producto_id: 2105813, sku: "463830-0", texto_variacion: "1 unidad", unidades_extraidas: 1 },
    { id: 2109234, producto_id: 2105813, sku: "463830-2", texto_variacion: "3 unidades", unidades_extraidas: 3 },
    { id: 2235745, producto_id: 2174950, sku: "2554788-1", texto_variacion: "2 unidades", unidades_extraidas: 2 },
  ],
  ordenes: [
    { id_orden: 1001, estado: "ENTREGADO", fecha_orden: "2026-04-03T15:30:00Z",
      fecha_guia_generada: "2026-04-04T14:00:00Z", numero_guia: "240000001",
      lineas: [{ variacion_id: 2109232, cantidad: 1 }] },
    { id_orden: 1002, estado: "PENDIENTE", fecha_orden: "2026-04-03T16:00:00Z",
      fecha_guia_generada: null, numero_guia: null,
      lineas: [{ variacion_id: 2109234, cantidad: 1 }] },
    // COMBO: una orden, dos productos distintos.
    { id_orden: 1003, estado: "EN REPARTO", fecha_orden: "2026-04-03T17:00:00Z",
      fecha_guia_generada: "2026-04-04T09:00:00Z", numero_guia: "240000003",
      lineas: [
        { variacion_id: 2109232, cantidad: 2 },
        { variacion_id: 2235745, cantidad: 1 },
      ] },
  ],
};

const r1 = await procesar(carga1);
check("órdenes nuevas = 3", r1.ordenes_nuevas, 3);
check("órdenes omitidas = 0", r1.ordenes_omitidas, 0);
check("líneas insertadas = 4 (1+1+2 del combo)", r1.lineas_insertadas, 4);
check("productos nuevos = 2", r1.productos_nuevos, 2);
check("variaciones nuevas = 3", r1.variaciones_nuevas, 3);

const combo = (await db.query(
  "select variacion_id::text, cantidad from orden_productos where orden_id = 1003 order by variacion_id"
)).rows;
check("el combo 1003 quedó como 2 filas", combo, [
  { variacion_id: "2109232", cantidad: 2 },
  { variacion_id: "2235745", cantidad: 1 },
]);

/* ------------------------------------------------------------------ */
console.log("\n── Carga 2: el MISMO archivo otra vez (duplicados) ──");

const r2 = await procesar(carga1);
check("órdenes nuevas = 0", r2.ordenes_nuevas, 0);
check("órdenes omitidas = 3", r2.ordenes_omitidas, 3);
check("ids omitidos", r2.ids_omitidos.map(Number).sort(), [1001, 1002, 1003]);
check("líneas insertadas = 0", r2.lineas_insertadas, 0);
check("no se duplicó ninguna línea", Number((await db.query("select count(*)::int c from orden_productos")).rows[0].c), 4);
check("no se duplicó ninguna orden", Number((await db.query("select count(*)::int c from ordenes")).rows[0].c), 3);

/* ------------------------------------------------------------------ */
console.log("\n── Carga 3: archivo mixto (una repetida + una nueva) ──");

const r3 = await procesar({
  productos: [{ id: 2105813, nombre: "Hydra" }],
  variaciones: [
    { id: 2109232, producto_id: 2105813, sku: "463830-0", texto_variacion: "1 unidad", unidades_extraidas: 1 },
  ],
  ordenes: [
    // Ya existe y además viene con otro estado: debe quedar intacta.
    { id_orden: 1001, estado: "DEVOLUCION", fecha_orden: "2026-04-03T15:30:00Z",
      fecha_guia_generada: null, numero_guia: "CAMBIADA",
      lineas: [{ variacion_id: 2109232, cantidad: 99 }] },
    { id_orden: 1004, estado: "DESPACHADA", fecha_orden: "2026-04-05T12:00:00Z",
      fecha_guia_generada: "2026-04-05T13:00:00Z", numero_guia: "240000004",
      lineas: [{ variacion_id: 2109232, cantidad: 1 }] },
  ],
});
check("órdenes nuevas = 1", r3.ordenes_nuevas, 1);
check("órdenes omitidas = 1", r3.ordenes_omitidas, 1);

const orden1001 = (await db.query(
  "select estado, numero_guia from ordenes where id_orden = 1001"
)).rows[0];
check("la orden duplicada NO se actualizó", orden1001, { estado: "ENTREGADO", numero_guia: "240000001" });
check("la línea de la orden duplicada NO cambió",
  (await db.query("select cantidad from orden_productos where orden_id=1001")).rows[0].cantidad, 1);

/* ------------------------------------------------------------------ */
console.log("\n── Carga 4: misma variación dos veces en la misma orden ──");

const r4 = await procesar({
  productos: [{ id: 2105813, nombre: "Hydra" }],
  variaciones: [
    { id: 2109232, producto_id: 2105813, sku: "463830-0", texto_variacion: "1 unidad", unidades_extraidas: 1 },
  ],
  ordenes: [
    { id_orden: 1005, estado: "PENDIENTE", fecha_orden: "2026-04-06T10:00:00Z",
      fecha_guia_generada: null, numero_guia: null,
      lineas: [
        { variacion_id: 2109232, cantidad: 2 },
        { variacion_id: 2109232, cantidad: 3 },
      ] },
  ],
});
check("no revienta por el unique", r4.ordenes_nuevas, 1);
check("se insertó UNA sola línea", r4.lineas_insertadas, 1);
check("con las cantidades sumadas (2+3=5)",
  (await db.query("select cantidad from orden_productos where orden_id=1005")).rows[0].cantidad, 5);

/* ------------------------------------------------------------------ */
console.log("\n── Carga 5: catálogo — corrige nombre, conserva unidades ──");

const r5 = await procesar({
  productos: [{ id: 2105813, nombre: "Hydra Plus" }],
  variaciones: [
    // El parser no logró extraer unidades esta vez: no debe borrar el 1 anterior.
    { id: 2109232, producto_id: 2105813, sku: null, texto_variacion: null, unidades_extraidas: null },
  ],
  ordenes: [],
});
check("no se registró producto nuevo", r5.productos_nuevos, 0);
check("el nombre se actualizó desde Dropi",
  (await db.query("select nombre from productos where id=2105813")).rows[0].nombre, "Hydra Plus");
check("unidades_extraidas se conservó",
  Number((await db.query("select unidades_extraidas from producto_variaciones where id=2109232")).rows[0].unidades_extraidas), 1);
check("sku se conservó",
  (await db.query("select sku from producto_variaciones where id=2109232")).rows[0].sku, "463830-0");

/* ------------------------------------------------------------------ */
console.log("\n── Carga 6: atomicidad — una línea inválida tumba TODO el archivo ──");

const antes = Number((await db.query("select count(*)::int c from ordenes")).rows[0].c);
let lanzo = false;
try {
  await procesar({
    productos: [{ id: 2105813, nombre: "Hydra" }],
    variaciones: [{ id: 2109232, producto_id: 2105813, sku: null, texto_variacion: null, unidades_extraidas: null }],
    ordenes: [
      { id_orden: 2001, estado: "OK", fecha_orden: "2026-04-07T10:00:00Z",
        fecha_guia_generada: null, numero_guia: null,
        lineas: [{ variacion_id: 2109232, cantidad: 1 }] },
      // variación inexistente → viola la FK
      { id_orden: 2002, estado: "OK", fecha_orden: "2026-04-07T11:00:00Z",
        fecha_guia_generada: null, numero_guia: null,
        lineas: [{ variacion_id: 999999999, cantidad: 1 }] },
    ],
  });
} catch { lanzo = true; }
check("la función falla", lanzo, true);
check("y NO quedó nada a medias (rollback)",
  Number((await db.query("select count(*)::int c from ordenes")).rows[0].c), antes);

/* ------------------------------------------------------------------ */
console.log("\n── Carga 7: archivo vacío ──");
const r7 = await procesar({ productos: [], variaciones: [], ordenes: [] });
check("no falla con arrays vacíos",
  [r7.ordenes_nuevas, r7.ordenes_omitidas, r7.lineas_insertadas], [0, 0, 0]);

console.log(`\n${fallos === 0 ? "TODAS LAS PRUEBAS SQL PASARON" : `${fallos} PRUEBAS FALLARON`}`);
process.exit(fallos === 0 ? 0 : 1);
