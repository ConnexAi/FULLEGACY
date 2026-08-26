/**
 * Prueba end-to-end de la ingesta del Sprint 1.
 *
 * Genera un .xlsx con la forma real del export de Dropi (54 columnas, datos
 * verificados del contexto), lo pasa por el parser y el agrupador reales, y
 * guarda el resultado en un Postgres real (WASM) con las migraciones del repo.
 */
import ExcelJS from "exceljs";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

import { parsearExcelDropi } from "@/lib/dropi/parser";
import { agruparCarga } from "@/lib/dropi/carga";
import { extraerUnidades } from "@/lib/dropi/unidades";
import { parsearFechaDropi } from "@/lib/dropi/fechas";
import { ErrorArchivoDropi } from "@/lib/dropi/tipos";

const RAIZ = new URL("..", import.meta.url).pathname;

let fallos = 0;
function check(nombre: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos += 1;
  console.log(
    `${ok ? "  ok  " : "FALLA"} ${nombre}` +
      (ok ? "" : `\n        esperado: ${JSON.stringify(esperado)}\n        real:     ${JSON.stringify(real)}`),
  );
}

/* ── Generador de un xlsx con la forma real de Dropi ──────────────────── */

/** Las 54 columnas del export. Las relevantes van intercaladas, como en el real. */
const COLUMNAS_54 = [
  "ID", "ESTATUS", "FECHA", "TIPO DE ENVIO", "TRANSPORTADORA", "NÚMERO GUIA",
  "FECHA GUIA GENERADA", "CLIENTE", "TELEFONO", "DIRECCION", "CIUDAD",
  "DEPARTAMENTO", "PAIS", "NOTAS", "PRODUCTO ID", "SKU", "VARIACION ID",
  "PRODUCTO", "VARIACION", "CANTIDAD", "PRECIO", "COSTO", "FLETE",
  ...Array.from({ length: 31 }, (_, i) => `COLUMNA EXTRA ${i + 1}`),
];

interface FilaCruda {
  ID?: unknown; ESTATUS?: unknown; FECHA?: unknown;
  "NÚMERO GUIA"?: unknown; "FECHA GUIA GENERADA"?: unknown;
  "PRODUCTO ID"?: unknown; SKU?: unknown; "VARIACION ID"?: unknown;
  PRODUCTO?: unknown; VARIACION?: unknown; CANTIDAD?: unknown;
}

async function construirXlsx(
  filas: FilaCruda[],
  columnas: string[] = COLUMNAS_54,
): Promise<ArrayBuffer> {
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet("Ordenes");
  hoja.addRow(columnas);

  for (const fila of filas) {
    hoja.addRow(
      columnas.map((c) =>
        Object.prototype.hasOwnProperty.call(fila, c)
          ? ((fila as Record<string, unknown>)[c] ?? null)
          : null,
      ),
    );
  }

  const buffer = await libro.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

/* ── Base de datos ───────────────────────────────────────────────────── */

const db = await PGlite.create();
await db.exec("create role anon; create role authenticated; create role service_role;");
for (const m of [
  "20260825120000_esquema_inicial.sql",
  "20260826090000_ordenes_numero_guia.sql",
  "20260826090100_procesar_carga.sql",
]) {
  await db.exec(readFileSync(`${RAIZ}supabase/migrations/${m}`, "utf8"));
}

async function guardar(carga: unknown) {
  const r = await db.query<{ r: Record<string, number | number[]> }>(
    "select public.procesar_carga($1::jsonb) as r",
    [JSON.stringify(carga)],
  );
  return r.rows[0].r;
}

/* ── Unidades ────────────────────────────────────────────────────────── */
console.log("── extraerUnidades ──");
check('"1 unidad" → 1', extraerUnidades("1 unidad"), 1);
check('"3 unidades" → 3', extraerUnidades("3 unidades"), 3);
check('"10 UNIDADES" → 10', extraerUnidades("10 UNIDADES"), 10);
check('"2 Unidádes" (con tilde) → 2', extraerUnidades("2 Unidádes"), 2);
check('"p01" → null (no es de cantidad)', extraerUnidades("p01"), null);
check('"Rojo talla M" → null', extraerUnidades("Rojo talla M"), null);
check("null → null", extraerUnidades(null), null);

/* ── Fechas ──────────────────────────────────────────────────────────── */
console.log("\n── parsearFechaDropi (hora de pared bogotana → UTC) ──");
check(
  '"03/04/2026 10:30:00" = 3 de abril 15:30 UTC',
  parsearFechaDropi("03/04/2026 10:30:00")?.toISOString(),
  "2026-04-03T15:30:00.000Z",
);
check(
  '"2026-04-03 10:30" (ISO) mismo instante',
  parsearFechaDropi("2026-04-03 10:30")?.toISOString(),
  "2026-04-03T15:30:00.000Z",
);
check(
  "Date de ExcelJS (componentes en UTC) mismo instante",
  parsearFechaDropi(new Date(Date.UTC(2026, 3, 3, 10, 30)))?.toISOString(),
  "2026-04-03T15:30:00.000Z",
);
check('"31/02/2026" (fecha imposible) → null', parsearFechaDropi("31/02/2026"), null);
check('"" → null', parsearFechaDropi(""), null);
check('"no es fecha" → null', parsearFechaDropi("no es fecha"), null);

/* ── Aborto por columnas críticas faltantes ──────────────────────────── */
console.log("\n── Validación de columnas críticas ──");
{
  const sinProductoId = COLUMNAS_54.filter((c) => c !== "PRODUCTO ID" && c !== "VARIACION ID");
  const buf = await construirXlsx(
    [{ ID: 1, ESTATUS: "ENTREGADO", FECHA: "03/04/2026", CANTIDAD: 1 }],
    sinProductoId,
  );
  let mensaje = "";
  try {
    await parsearExcelDropi(buf);
  } catch (e) {
    mensaje = e instanceof ErrorArchivoDropi ? e.message : `otro error: ${String(e)}`;
  }
  check("aborta el archivo completo", mensaje.includes("faltan columnas obligatorias"), true);
  check("nombra las dos que faltan",
    mensaje.includes("PRODUCTO ID") && mensaje.includes("VARIACION ID"), true);
  check("dice que no procesó nada", mensaje.includes("No se procesó ninguna fila"), true);
}
{
  let mensaje = "";
  try {
    await parsearExcelDropi(new TextEncoder().encode("esto no es un xlsx").buffer as ArrayBuffer);
  } catch (e) {
    mensaje = e instanceof ErrorArchivoDropi ? e.message : `otro error: ${String(e)}`;
  }
  check("un archivo que no es xlsx también aborta", mensaje.includes("No se pudo abrir"), true);
}

/* ── Archivo 1: combo + variaciones + fila con error ─────────────────── */
console.log("\n── Archivo 1 (parser → agrupador → BD) ──");

const archivo1 = await construirXlsx([
  // Orden simple, Hydra 1 unidad
  { ID: 1001, ESTATUS: "ENTREGADO", FECHA: "03/04/2026 10:30:00",
    "NÚMERO GUIA": "240000001", "FECHA GUIA GENERADA": "04/04/2026 09:00:00",
    "PRODUCTO ID": 2105813, SKU: "463830-0", "VARIACION ID": 2109232,
    PRODUCTO: "Hydra", VARIACION: "1 unidad", CANTIDAD: 1 },

  // COMBO: la orden 1003 ocupa DOS filas, una por producto
  { ID: 1003, ESTATUS: "EN REPARTO", FECHA: "03/04/2026 17:00:00",
    "NÚMERO GUIA": "240000003", "FECHA GUIA GENERADA": "04/04/2026 09:00:00",
    "PRODUCTO ID": 2105813, SKU: "463830-0", "VARIACION ID": 2109232,
    PRODUCTO: "Hydra", VARIACION: "1 unidad", CANTIDAD: 2 },
  { ID: 1003, ESTATUS: "EN REPARTO", FECHA: "03/04/2026 17:00:00",
    "NÚMERO GUIA": "240000003", "FECHA GUIA GENERADA": "04/04/2026 09:00:00",
    "PRODUCTO ID": 2174950, SKU: "2554788-1", "VARIACION ID": 2235745,
    PRODUCTO: "Focus men", VARIACION: "2 unidades", CANTIDAD: 1 },

  // Variación NO numérica (pulsera): unidades_extraidas debe quedar null
  { ID: 1004, ESTATUS: "PENDIENTE", FECHA: "04/04/2026 08:00:00",
    "NÚMERO GUIA": null, "FECHA GUIA GENERADA": null,
    "PRODUCTO ID": 3001, SKU: "PUL-01", "VARIACION ID": 3101,
    PRODUCTO: "Pulsera Vancleef A1", VARIACION: "p01", CANTIDAD: 1 },

  // FILA CON ERROR: PRODUCTO ID vacío → no debe tumbar el archivo
  { ID: 1005, ESTATUS: "ENTREGADO", FECHA: "04/04/2026 09:00:00",
    "PRODUCTO ID": null, SKU: "X", "VARIACION ID": 4444,
    PRODUCTO: "Fantasma", VARIACION: "1 unidad", CANTIDAD: 1 },

  // FILA CON ERROR dentro de un combo: la orden 1006 pierde una línea
  { ID: 1006, ESTATUS: "DESPACHADA", FECHA: "04/04/2026 10:00:00",
    "PRODUCTO ID": 2105813, SKU: "463830-0", "VARIACION ID": 2109232,
    PRODUCTO: "Hydra", VARIACION: "1 unidad", CANTIDAD: 1 },
  { ID: 1006, ESTATUS: "DESPACHADA", FECHA: "04/04/2026 10:00:00",
    "PRODUCTO ID": 2174950, SKU: "2554788-1", "VARIACION ID": 2235745,
    PRODUCTO: "Focus men", VARIACION: "2 unidades", CANTIDAD: 0 }, // cantidad inválida

  // Fila totalmente vacía en medio del archivo
  {},

  // MISMA variación dos veces en la MISMA orden → deben sumarse
  { ID: 1007, ESTATUS: "PENDIENTE", FECHA: "05/04/2026 08:00:00",
    "PRODUCTO ID": 2105813, SKU: "463830-0", "VARIACION ID": 2109232,
    PRODUCTO: "Hydra", VARIACION: "1 unidad", CANTIDAD: 2 },
  { ID: 1007, ESTATUS: "PENDIENTE", FECHA: "05/04/2026 08:00:00",
    "PRODUCTO ID": 2105813, SKU: "463830-0", "VARIACION ID": 2109232,
    PRODUCTO: "Hydra", VARIACION: "1 unidad", CANTIDAD: 3 },
]);

const p1 = await parsearExcelDropi(archivo1);
check("filas leídas: 10 escritas - 1 vacía = 9", p1.filasLeidas, 9);
check("filas válidas: 9 - 2 con error = 7", p1.filas.length, 7);
check("filas con error", p1.errores.length, 2);
check("error 1: PRODUCTO ID vacío", p1.errores[0].motivo.includes("PRODUCTO ID está vacío"), true);
check("error 1 atribuido a su orden", p1.errores[0].idOrden, 1005);
check("error 2: CANTIDAD inválida", p1.errores[1].motivo.includes("CANTIDAD debe ser un entero positivo"), true);
check("error 2 atribuido al combo 1006", p1.errores[1].idOrden, 1006);
check("ignora las 43 columnas irrelevantes",
  Object.keys(p1.filas[0]).sort(),
  ["cantidad","estado","fechaGuiaGenerada","fechaOrden","fila","idOrden","numeroGuia",
   "productoId","productoNombre","sku","textoVariacion","variacionId"]);

const carga1 = agruparCarga(p1.filas);
check("órdenes agrupadas", carga1.ordenes.map((o) => o.id_orden), [1001, 1003, 1004, 1006, 1007]);
check("el combo 1003 tiene 2 líneas",
  carga1.ordenes.find((o) => o.id_orden === 1003)!.lineas,
  [{ variacion_id: 2109232, cantidad: 2 }, { variacion_id: 2235745, cantidad: 1 }]);
check("la orden 1006 quedó con 1 sola línea (perdió la errónea)",
  carga1.ordenes.find((o) => o.id_orden === 1006)!.lineas.length, 1);
check("catálogo: 3 productos", carga1.productos.map((p) => p.id).sort(), [2105813, 2174950, 3001]);
check("variación 'p01' → unidades null",
  carga1.variaciones.find((v) => v.id === 3101)!.unidades_extraidas, null);
check("variación '2 unidades' → 2",
  carga1.variaciones.find((v) => v.id === 2235745)!.unidades_extraidas, 2);
check("fecha de orden convertida a UTC desde hora bogotana",
  carga1.ordenes[0].fecha_orden, "2026-04-03T15:30:00.000Z");

const g1 = await guardar(carga1);
check("BD: órdenes nuevas = 5", g1.ordenes_nuevas, 5);
check("BD: omitidas = 0", g1.ordenes_omitidas, 0);
check("BD: líneas = 6 (1+2+1+1+1 sumada)", g1.lineas_insertadas, 6);
check("BD: productos nuevos = 3", g1.productos_nuevos, 3);
check("BD: variaciones nuevas = 3", g1.variaciones_nuevas, 3);
check("BD: el combo 1003 quedó en 2 filas",
  Number((await db.query<{c:number}>("select count(*)::int c from orden_productos where orden_id=1003")).rows[0].c), 2);
check("BD: la variación repetida se sumó (2+3=5)",
  (await db.query<{cantidad:number}>("select cantidad from orden_productos where orden_id=1007")).rows[0].cantidad, 5);
check("BD: numero_guia guardado",
  (await db.query<{numero_guia:string}>("select numero_guia from ordenes where id_orden=1001")).rows[0].numero_guia, "240000001");
check("BD: fecha_guia_generada null cuando no viene",
  (await db.query<{f:unknown}>("select fecha_guia_generada f from ordenes where id_orden=1004")).rows[0].f, null);

/* ── Archivo 2: el mismo archivo otra vez ────────────────────────────── */
console.log("\n── Archivo 2: se vuelve a subir el MISMO archivo ──");

const p2 = await parsearExcelDropi(await construirXlsx([
  { ID: 1001, ESTATUS: "ENTREGADO", FECHA: "03/04/2026 10:30:00",
    "NÚMERO GUIA": "240000001", "FECHA GUIA GENERADA": "04/04/2026 09:00:00",
    "PRODUCTO ID": 2105813, SKU: "463830-0", "VARIACION ID": 2109232,
    PRODUCTO: "Hydra", VARIACION: "1 unidad", CANTIDAD: 1 },
  { ID: 1003, ESTATUS: "EN REPARTO", FECHA: "03/04/2026 17:00:00",
    "PRODUCTO ID": 2105813, SKU: "463830-0", "VARIACION ID": 2109232,
    PRODUCTO: "Hydra", VARIACION: "1 unidad", CANTIDAD: 2 },
  { ID: 1003, ESTATUS: "EN REPARTO", FECHA: "03/04/2026 17:00:00",
    "PRODUCTO ID": 2174950, SKU: "2554788-1", "VARIACION ID": 2235745,
    PRODUCTO: "Focus men", VARIACION: "2 unidades", CANTIDAD: 1 },
  // Una orden NUEVA mezclada entre las repetidas
  { ID: 2001, ESTATUS: "GUIA_GENERADA", FECHA: "06/04/2026 11:00:00",
    "NÚMERO GUIA": "240002001", "FECHA GUIA GENERADA": "06/04/2026 12:00:00",
    "PRODUCTO ID": 2105813, SKU: "463830-2", "VARIACION ID": 2109234,
    PRODUCTO: "Hydra", VARIACION: "3 unidades", CANTIDAD: 1 },
]));

const g2 = await guardar(agruparCarga(p2.filas));
check("solo entra la orden nueva", g2.ordenes_nuevas, 1);
check("las repetidas se omiten", g2.ordenes_omitidas, 2);
check("ids omitidos", (g2.ids_omitidos as number[]).map(Number).sort(), [1001, 1003]);
check("no se duplicaron líneas del combo",
  Number((await db.query<{c:number}>("select count(*)::int c from orden_productos where orden_id=1003")).rows[0].c), 2);
check("total de órdenes en BD = 6",
  Number((await db.query<{c:number}>("select count(*)::int c from ordenes")).rows[0].c), 6);
check("catálogo: la variación '3 unidades' se auto-registró",
  Number((await db.query<{u:string}>("select unidades_extraidas u from producto_variaciones where id=2109234")).rows[0].u), 3);
check("el mismo PRODUCTO ID agrupa sus 2 variaciones",
  Number((await db.query<{c:number}>("select count(*)::int c from producto_variaciones where producto_id=2105813")).rows[0].c), 2);

console.log(`\n${fallos === 0 ? "TODAS LAS PRUEBAS E2E PASARON" : `${fallos} PRUEBAS FALLARON`}`);
process.exit(fallos === 0 ? 0 : 1);
