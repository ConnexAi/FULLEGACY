/**
 * Ejecuta las migraciones reales del proyecto sobre un Postgres 18 en WASM
 * y verifica el comportamiento de procesar_carga(): duplicados, combos,
 * variación repetida y auto-registro de catálogo.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const RAIZ = new URL("..", import.meta.url).pathname;
// Todas las migraciones del repo, en orden de timestamp.
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
];

// PGlite vuelca todo su bundle en el stack: sobra ruido para leer un fallo.
process.on("uncaughtException", (e) => {
  console.error("\nERROR:", e.message);
  process.exit(1);
});

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
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
`);

for (const archivo of MIGRACIONES) {
  const sql = readFileSync(`${RAIZ}supabase/migrations/${archivo}`, "utf8");
  await db.exec(sql);
  console.log(`migración aplicada: ${archivo}`);
}
console.log();

let nArchivo = 0;
const procesar = async (carga) => {
  nArchivo += 1;
  const { archivo, ...resto } = carga;
  const cuerpo = {
    ...resto,
    archivo: {
      nombre: archivo ?? `export-${nArchivo}.xlsx`,
      filas_leidas: 0,
      filas_con_error: 0,
    },
  };
  return (await db.query("select public.procesar_carga($1::jsonb) as r", [JSON.stringify(cuerpo)]))
    .rows[0].r;
};

/* ------------------------------------------------------------------ */
console.log("── Carga 1: dos órdenes simples + un combo ──");

const carga1 = {
  productos: [
    { id: 2105813, nombre: "Hydra", sku: null },
    { id: 2174950, nombre: "Focus men", sku: null },
  ],
  variaciones: [
    { id: 2109232, producto_id: 2105813, sku: "463830-0", texto_variacion: "1 unidad", unidades_extraidas: 1 },
    { id: 2109234, producto_id: 2105813, sku: "463830-2", texto_variacion: "3 unidades", unidades_extraidas: 3 },
    { id: 2235745, producto_id: 2174950, sku: "2554788-1", texto_variacion: "2 unidades", unidades_extraidas: 2 },
  ],
  ordenes: [
    { id_orden: 1001, estado: "ENTREGADO", fecha_orden: "2026-04-03T15:30:00Z",
      fecha_guia_generada: "2026-04-04T14:00:00Z", numero_guia: "240000001",
      lineas: [{ producto_id: 2105813, variacion_id: 2109232, cantidad: 1 }] },
    { id_orden: 1002, estado: "PENDIENTE", fecha_orden: "2026-04-03T16:00:00Z",
      fecha_guia_generada: null, numero_guia: null,
      lineas: [{ producto_id: 2105813, variacion_id: 2109234, cantidad: 1 }] },
    // COMBO: una orden, dos productos distintos.
    { id_orden: 1003, estado: "EN REPARTO", fecha_orden: "2026-04-03T17:00:00Z",
      fecha_guia_generada: "2026-04-04T09:00:00Z", numero_guia: "240000003",
      lineas: [
        { producto_id: 2105813, variacion_id: 2109232, cantidad: 2 },
        { producto_id: 2174950, variacion_id: 2235745, cantidad: 1 },
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
  "select producto_id::text, variacion_id::text, cantidad from orden_productos where orden_id = 1003 order by variacion_id"
)).rows;
check("el combo 1003 quedó como 2 filas", combo, [
  { producto_id: "2105813", variacion_id: "2109232", cantidad: 2 },
  { producto_id: "2174950", variacion_id: "2235745", cantidad: 1 },
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
  productos: [{ id: 2105813, nombre: "Hydra", sku: null }],
  variaciones: [
    { id: 2109232, producto_id: 2105813, sku: "463830-0", texto_variacion: "1 unidad", unidades_extraidas: 1 },
  ],
  ordenes: [
    // Ya existe y además viene con otro estado: debe quedar intacta.
    { id_orden: 1001, estado: "DEVOLUCION", fecha_orden: "2026-04-03T15:30:00Z",
      fecha_guia_generada: null, numero_guia: "CAMBIADA",
      lineas: [{ producto_id: 2105813, variacion_id: 2109232, cantidad: 99 }] },
    { id_orden: 1004, estado: "DESPACHADA", fecha_orden: "2026-04-05T12:00:00Z",
      fecha_guia_generada: "2026-04-05T13:00:00Z", numero_guia: "240000004",
      lineas: [{ producto_id: 2105813, variacion_id: 2109232, cantidad: 1 }] },
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
  productos: [{ id: 2105813, nombre: "Hydra", sku: null }],
  variaciones: [
    { id: 2109232, producto_id: 2105813, sku: "463830-0", texto_variacion: "1 unidad", unidades_extraidas: 1 },
  ],
  ordenes: [
    { id_orden: 1005, estado: "PENDIENTE", fecha_orden: "2026-04-06T10:00:00Z",
      fecha_guia_generada: null, numero_guia: null,
      lineas: [
        { producto_id: 2105813, variacion_id: 2109232, cantidad: 2 },
        { producto_id: 2105813, variacion_id: 2109232, cantidad: 3 },
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
  productos: [{ id: 2105813, nombre: "Hydra Plus", sku: null }],
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
    productos: [{ id: 2105813, nombre: "Hydra", sku: null }],
    variaciones: [{ id: 2109232, producto_id: 2105813, sku: null, texto_variacion: null, unidades_extraidas: null }],
    ordenes: [
      { id_orden: 2001, estado: "OK", fecha_orden: "2026-04-07T10:00:00Z",
        fecha_guia_generada: null, numero_guia: null,
        lineas: [{ producto_id: 2105813, variacion_id: 2109232, cantidad: 1 }] },
      // variación inexistente → viola la FK
      { id_orden: 2002, estado: "OK", fecha_orden: "2026-04-07T11:00:00Z",
        fecha_guia_generada: null, numero_guia: null,
        lineas: [{ producto_id: 2105813, variacion_id: 999999999, cantidad: 1 }] },
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

/* ------------------------------------------------------------------ */
console.log("\n── Carga 8: PRODUCTO SIN VARIACIÓN (el bug del modelo viejo) ──");

const r8 = await procesar({
  archivo: "sin-variantes.xlsx",
  // Waggy pet: 284 filas en el archivo real, ninguna con VARIACION ID.
  productos: [{ id: 2103415, nombre: "Waggy pet", sku: "5038494" }],
  variaciones: [],
  ordenes: [
    { id_orden: 3001, estado: "ENTREGADO", fecha_orden: "2026-04-08T10:00:00Z",
      fecha_guia_generada: "2026-04-08T12:00:00Z", numero_guia: "240003001",
      lineas: [{ producto_id: 2103415, variacion_id: null, cantidad: 2 }] },
  ],
});
check("se guarda sin variación, sin error", r8.ordenes_nuevas, 1);
check("la línea se insertó", r8.lineas_insertadas, 1);
check("no se inventó ninguna variación", r8.variaciones_nuevas, 0);
check("el producto se registró", r8.productos_nuevos, 1);

const l8 = (await db.query(
  "select producto_id::text, variacion_id, cantidad from orden_productos where orden_id=3001"
)).rows[0];
check("variacion_id quedó NULL", l8.variacion_id, null);
check("producto_id quedó puesto", l8.producto_id, "2103415");
check("el SKU quedó en productos.sku",
  (await db.query("select sku from productos where id=2103415")).rows[0].sku, "5038494");

console.log("\n── Carga 9: mismo producto sin variación dos veces en una orden ──");
const r9 = await procesar({
  archivo: "sin-variantes-repetido.xlsx",
  productos: [{ id: 2103415, nombre: "Waggy pet", sku: "5038494" }],
  variaciones: [],
  ordenes: [
    { id_orden: 3002, estado: "PENDIENTE", fecha_orden: "2026-04-08T11:00:00Z",
      fecha_guia_generada: null, numero_guia: null,
      lineas: [
        { producto_id: 2103415, variacion_id: null, cantidad: 1 },
        { producto_id: 2103415, variacion_id: null, cantidad: 4 },
      ] },
  ],
});
check("NULLS NOT DISTINCT las trata como la misma línea", r9.lineas_insertadas, 1);
check("con las cantidades sumadas (1+4=5)",
  (await db.query("select cantidad from orden_productos where orden_id=3002")).rows[0].cantidad, 5);

console.log("\n── Carga 10: combo que mezcla producto con y sin variación ──");
const r10 = await procesar({
  archivo: "combo-mixto.xlsx",
  productos: [
    { id: 2105813, nombre: "Hydra", sku: null },
    { id: 2103415, nombre: "Waggy pet", sku: "5038494" },
  ],
  variaciones: [
    { id: 2109232, producto_id: 2105813, sku: "463830-0", texto_variacion: "1 unidad", unidades_extraidas: 1 },
  ],
  ordenes: [
    { id_orden: 3003, estado: "EN REPARTO", fecha_orden: "2026-04-09T09:00:00Z",
      fecha_guia_generada: null, numero_guia: null,
      lineas: [
        { producto_id: 2105813, variacion_id: 2109232, cantidad: 1 },
        { producto_id: 2103415, variacion_id: null, cantidad: 2 },
      ] },
  ],
});
check("el combo mixto entra completo", r10.lineas_insertadas, 2);
check("una línea con variación y otra sin",
  (await db.query("select count(*) filter (where variacion_id is null)::int sinv, count(*) filter (where variacion_id is not null)::int conv from orden_productos where orden_id=3003")).rows[0],
  { sinv: 1, conv: 1 });

console.log("\n── La FK compuesta impide cruzar producto y variación ──");
let cruzo = false;
try {
  await procesar({
    archivo: "cruzado.xlsx",
    productos: [{ id: 2103415, nombre: "Waggy pet", sku: null }],
    variaciones: [],
    ordenes: [
      // variación de Hydra declarada bajo Waggy pet
      { id_orden: 3004, estado: "X", fecha_orden: "2026-04-09T10:00:00Z",
        fecha_guia_generada: null, numero_guia: null,
        lineas: [{ producto_id: 2103415, variacion_id: 2109232, cantidad: 1 }] },
    ],
  });
} catch { cruzo = true; }
check("rechaza producto A con variación de B", cruzo, true);

console.log("\n── Historial de cargas ──");
const cargas = (await db.query(
  "select id, nombre_archivo, ordenes_nuevas, ordenes_omitidas from cargas order by id"
)).rows;
check("se registró una carga por archivo procesado", cargas.length >= 9, true);
check("la primera guardó 3 órdenes", Number(cargas[0].ordenes_nuevas), 3);
check("la segunda (mismo archivo) omitió 3", Number(cargas[1].ordenes_omitidas), 3);
check("las órdenes quedan ligadas a su carga",
  Number((await db.query("select count(*)::int c from ordenes where carga_id is null")).rows[0].c), 0);
const cargaDeLaOrden = (await db.query(
  "select c.nombre_archivo from ordenes o join cargas c on c.id=o.carga_id where o.id_orden=3001"
)).rows[0].nombre_archivo;
check("se puede reconstruir de qué archivo vino una orden", cargaDeLaOrden, "sin-variantes.xlsx");

/* ------------------------------------------------------------------ */
console.log("\n── REGRESIÓN: producto_id se guarda TAMBIÉN en las filas CON variación ──");
// El bug real: el código viejo llenaba la línea solo con variacion_id, y el
// insert moría con "null value in column producto_id ... violates not-null".

const rReg = await procesar({
  archivo: "con-variacion.xlsx",
  productos: [{ id: 2105813, nombre: "Hydra", sku: null }],
  variaciones: [
    { id: 2109233, producto_id: 2105813, sku: "463830-1", texto_variacion: "2 unidades", unidades_extraidas: 2 },
  ],
  ordenes: [
    { id_orden: 4001, estado: "ENTREGADO", fecha_orden: "2026-04-10T15:00:00Z",
      fecha_guia_generada: null, numero_guia: null,
      lineas: [{ producto_id: 2105813, variacion_id: 2109233, cantidad: 1 }] },
  ],
});
check("la orden con variación entra", rReg.ordenes_nuevas, 1);
const lReg = (await db.query(
  "select producto_id::text, variacion_id::text from orden_productos where orden_id=4001"
)).rows[0];
check("producto_id NO quedó null (el bug)", lReg.producto_id, "2105813");
check("y variacion_id también quedó guardado", lReg.variacion_id, "2109233");

check("NINGUNA línea de la base tiene producto_id null",
  Number((await db.query("select count(*)::int c from orden_productos where producto_id is null")).rows[0].c), 0);

console.log("\n── El payload del modelo VIEJO se rechaza con un mensaje claro ──");
let msgViejo = "";
try {
  await procesar({
    archivo: "payload-viejo.xlsx",
    productos: [{ id: 2105813, nombre: "Hydra", sku: null }],
    variaciones: [
      { id: 2109233, producto_id: 2105813, sku: "463830-1", texto_variacion: "2 unidades", unidades_extraidas: 2 },
    ],
    ordenes: [
      { id_orden: 4002, estado: "ENTREGADO", fecha_orden: "2026-04-10T16:00:00Z",
        fecha_guia_generada: null, numero_guia: null,
        // forma anterior: sin producto_id
        lineas: [{ variacion_id: 2109233, cantidad: 1 }] },
    ],
  });
} catch (e) { msgViejo = e.message; }
check("se rechaza", msgViejo !== "", true);
check("y el mensaje explica la causa (app desactualizada), no un NOT NULL crudo",
  /sin producto_id/.test(msgViejo) && /modelo anterior/.test(msgViejo), true);
console.log("      mensaje: " + msgViejo.slice(0, 120) + "…");
check("no quedó la carga a medias",
  Number((await db.query("select count(*)::int c from ordenes where id_orden=4002")).rows[0].c), 0);

console.log(`\n${fallos === 0 ? "TODAS LAS PRUEBAS SQL PASARON" : `${fallos} PRUEBAS FALLARON`}`);
process.exit(fallos === 0 ? 0 : 1);
