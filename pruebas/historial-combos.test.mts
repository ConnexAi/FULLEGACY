/**
 * Historial mensual con hoja Combos: cada orden cuenta en una sola hoja.
 *
 * Corre contra las migraciones reales (Postgres en WASM) para probar
 * `historial_mensual_ordenes()` de punta a punta, y reabre el Excel generado.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import ExcelJS from "exceljs";

import { generarExcelHistorialMensual } from "@/lib/reportes/excel-historial-mensual";
import {
  construirHistorialPorOrden,
  type DiaConOrdenes,
  type HistorialMensual,
  type TotalDia,
} from "@/lib/reportes/historial-mensual";
import { construirReporteOrdenado, type LineaCarga } from "@/lib/reportes/reporte-ordenado";

const RAIZ = decodeURIComponent(new URL("..", import.meta.url).pathname);
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
  "20260925100000_carga_ordenes_foto.sql",
  "20261009100000_latidos.sql",
  "20261017100000_historial_mensual_ordenes.sql",
];

let fallos = 0;
const check = (n: string, real: unknown, esp: unknown) => {
  const ok = JSON.stringify(real) === JSON.stringify(esp);
  if (!ok) fallos++;
  console.log(`${ok ? "  ok  " : "FALLA"} ${n}` +
    (ok ? "" : `\n        esperado: ${JSON.stringify(esp)}\n        real:     ${JSON.stringify(real)}`));
};

/* ── Base de datos ──────────────────────────────────────────────────────── */
const db = await PGlite.create();
await db.exec("create role anon; create role authenticated; create role service_role;");
await db.exec("create schema auth; create table auth.users (id uuid primary key default gen_random_uuid(), email text);");
for (const m of MIGRACIONES) await db.exec(readFileSync(`${RAIZ}supabase/migrations/${m}`, "utf8"));

const productos = [
  { id: 1, nombre: "AW chocolate" },
  { id: 2, nombre: "AW 839 azul" },
  { id: 3, nombre: "Hydra" },
  { id: 4, nombre: "Solo en combos" },
];

await db.exec(`
  insert into cargas (nombre_archivo) values ('prueba.xlsx');
  insert into productos (id, nombre) values
    (1, 'AW chocolate'), (2, 'AW 839 azul'), (3, 'Hydra'), (4, 'Solo en combos');
`);

/** Una orden con sus líneas, en el orden del archivo: [producto, cantidad]. */
async function orden(id: number, estado: string, guia: string | null, lineas: [number, number][]) {
  await db.query(
    `insert into ordenes (id_orden, estado, fecha_orden, fecha_guia_generada, carga_id)
       values ($1, $2, '2026-11-01T12:00:00Z', $3, 1)`,
    [id, estado, guia],
  );
  for (const [i, [producto, cantidad]] of lineas.entries()) {
    await db.query(
      `insert into orden_productos (orden_id, producto_id, variacion_id, cantidad, linea)
         values ($1, $2, null, $3, $4)`,
      [id, producto, cantidad, i + 1],
    );
  }
}

// Día 5 de noviembre 2026 (jueves): normales y combos mezclados.
await orden(201, "ENTREGADO",  "2026-11-05T15:00:00Z", [[3, 2]]);
await orden(202, "DEVOLUCION", "2026-11-05T15:00:00Z", [[3, 1]]);
await orden(203, "ENTREGADO",  "2026-11-05T15:00:00Z", [[1, 1]]);
// Combo 3 + 2.
await orden(204, "ENTREGADO",  "2026-11-05T16:00:00Z", [[1, 3], [2, 2]]);
// El mismo tipo con las líneas al revés, y devuelto.
await orden(205, " devolucion ", "2026-11-05T17:00:00Z", [[2, 2], [1, 3]]);
// "Solo en combos" nunca sale en una orden normal.
await orden(206, "ENTREGADO",  "2026-11-05T18:00:00Z", [[1, 1], [4, 1]]);
// Día 6: guía a las 9 pm de Bogotá (02:00 UTC del 7) — cae en el 6.
await orden(207, "ENTREGADO",  "2026-11-07T02:00:00Z", [[2, 1]]);
await orden(208, "ENTREGADO",  "2026-11-06T15:00:00Z", [[1, 1], [2, 1]]);
// Sin guía: no cuentan en ninguna hoja.
await orden(209, "PENDIENTE",  null, [[1, 5], [2, 5]]);
await orden(210, "PENDIENTE",  null, [[3, 7]]);
// Diciembre: solo órdenes normales.
await orden(301, "ENTREGADO",  "2026-12-02T15:00:00Z", [[3, 1]]);
await orden(302, "DEVOLUCION", "2026-12-03T15:00:00Z", [[1, 2]]);

async function historialDe(anio: number, mes: number): Promise<{
  historial: HistorialMensual;
  dias: DiaConOrdenes[];
  totales: TotalDia[];
}> {
  const dias = (await db.query<{ dia: number; ordenes: DiaConOrdenes["ordenes"] }>(
    "select * from public.historial_mensual_ordenes($1, $2)", [anio, mes],
  )).rows.map((f) => ({
    dia: Number(f.dia),
    ordenes: f.ordenes.map((o) => ({
      ...o,
      id_orden: Number(o.id_orden),
      lineas: o.lineas.map((l) => ({ producto_id: Number(l.producto_id), cantidad: Number(l.cantidad) })),
    })),
  }));
  const totales = (await db.query<TotalDia>(
    "select * from public.totales_diarios($1, $2)", [anio, mes],
  )).rows.map((f) => ({ dia: Number(f.dia), pedidos: Number(f.pedidos), unidades: Number(f.unidades) }));

  return { historial: construirHistorialPorOrden(anio, mes, productos, dias), dias, totales };
}

const { historial: noviembre, dias: diasNoviembre, totales: totalesNoviembre } =
  await historialDe(2026, 11);

const hoja = (nombre: string) => noviembre.hojas.find((h) => h.producto.nombre === nombre);
const filaDe = (nombre: string, dia: number) => hoja(nombre)?.filas.find((f) => f.dia === dia);
const combos = noviembre.combos!;

/** Suma de PEDIDOS de todas las hojas (productos + Combos) para un día. */
const pedidosDelDia = (h: HistorialMensual, dia: number) =>
  h.hojas.reduce((n, x) => n + (x.filas.find((f) => f.dia === dia)?.pedidos ?? 0), 0) +
  (h.combos?.filas.find((f) => f.dia === dia)?.pedidos ?? 0);

console.log("── La función SQL: una fila por día, con las órdenes adentro ──");
check("noviembre trae solo los días con movimiento", diasNoviembre.map((d) => d.dia), [5, 6]);
check("el día 5 trae sus 6 órdenes, sin las que no tienen guía",
  diasNoviembre[0].ordenes.map((o) => o.id_orden), [201, 202, 203, 204, 205, 206]);
check("las líneas vienen en el orden del archivo",
  diasNoviembre[0].ordenes.find((o) => o.id_orden === 205)?.lineas,
  [{ producto_id: 2, cantidad: 2 }, { producto_id: 1, cantidad: 3 }]);
check("el estado viene normalizado",
  diasNoviembre[0].ordenes.find((o) => o.id_orden === 205)?.estado, "DEVOLUCION");

console.log("\n── Día con normales y combos: la suma de PEDIDOS es igual a las órdenes únicas ──");
check("día 5: Hydra 2 normales", filaDe("Hydra", 5)?.pedidos, 2);
check("día 5: AW chocolate 1 normal (sus 3 combos no cuentan aquí)", filaDe("AW chocolate", 5)?.pedidos, 1);
check("día 5: AW 839 azul 0 pedidos propios", filaDe("AW 839 azul", 5)?.pedidos, 0);
check("día 5: Combos 3", combos.filas.find((f) => f.dia === 5)?.pedidos, 3);
for (const dia of [5, 6]) {
  check(`día ${dia}: suma de hojas = totales_diarios()`,
    pedidosDelDia(noviembre, dia), totalesNoviembre.find((t) => t.dia === dia)?.pedidos);
}
check("ningún otro día tiene pedidos en ninguna hoja",
  Array.from({ length: 30 }, (_, i) => i + 1)
    .filter((d) => d !== 5 && d !== 6)
    .every((d) => pedidosDelDia(noviembre, d) === 0), true);
const totalMesHojas = noviembre.hojas.reduce((n, h) => n + h.totalPedidos, 0) + combos.totalPedidos;
const totalMesSql = totalesNoviembre.reduce((n, t) => n + t.pedidos, 0);
check("total del mes: suma de hojas = suma de totales_diarios() = 8", [totalMesHojas, totalMesSql], [8, 8]);
check("y es el totalPedidos del historial", noviembre.totalPedidos, 8);

console.log("\n── Combo 3 + 2: las unidades suman en cada producto, 1 pedido en Combos ──");
// AW chocolate día 5: 1 (203) + 3 (204) + 3 (205) + 1 (206).
check("AW chocolate día 5: 8 unidades", filaDe("AW chocolate", 5)?.unidades, 8);
// AW 839 azul día 5: 2 (204) + 2 (205).
check("AW 839 azul día 5: 4 unidades, aunque no tenga pedidos propios ese día",
  filaDe("AW 839 azul", 5)?.unidades, 4);
check("el tipo 3 + 2 suma 2 pedidos en el detalle (204 y 205), uno por orden",
  combos.detalle.find((c) => c.nombre === "COMBO · AW chocolate (3) + AW 839 azul (2)")?.pedidos, 2);
check("totalUnidades incluye todo, también lo que solo vino en combos",
  noviembre.totalUnidades, totalesNoviembre.reduce((n, t) => n + t.unidades, 0));

console.log("\n── Un producto que solo sale en combos no tiene hoja ──");
check("no hay hoja de \"Solo en combos\"", hoja("Solo en combos"), undefined);
check("hojas de producto, A→Z", noviembre.hojas.map((h) => h.producto.nombre),
  ["AW 839 azul", "AW chocolate", "Hydra"]);
check("sus unidades se leen en el detalle de Combos",
  combos.detalle.some((c) => c.nombre === "COMBO · AW chocolate (1) + Solo en combos (1)"), true);

console.log("\n── Un combo devuelto cuenta en NO COMPLETADOS de Combos, no en los productos ──");
check("Combos día 5: 1 no completado (la 205)", combos.filas.find((f) => f.dia === 5)?.noCompletados, 1);
check("AW chocolate día 5: 0 no completados", filaDe("AW chocolate", 5)?.noCompletados, 0);
check("AW 839 azul día 5: 0 no completados", filaDe("AW 839 azul", 5)?.noCompletados, 0);
check("Hydra día 5: la devolución normal (202) sí cuenta en su hoja", filaDe("Hydra", 5)?.noCompletados, 1);
check("total de no completados en Combos", combos.totalNoCompletados, 1);

console.log("\n── El día se calcula en hora de Bogotá ──");
check("la 207 (02:00 UTC del 7) cae en el día 6", filaDe("AW 839 azul", 6)?.pedidos, 1);

console.log("\n── El detalle de combos agrupa igual que el Reporte Ordenado ──");
check("detalle del mes, A→Z", combos.detalle, [
  { nombre: "COMBO · AW chocolate (1) + AW 839 azul (1)", pedidos: 1 },
  { nombre: "COMBO · AW chocolate (1) + Solo en combos (1)", pedidos: 1 },
  { nombre: "COMBO · AW chocolate (3) + AW 839 azul (2)", pedidos: 2 },
]);
// Las mismas órdenes pasadas por el Reporte Ordenado.
const nombres = new Map(productos.map((p) => [p.id, p.nombre]));
const lineas: LineaCarga[] = diasNoviembre.flatMap((d) => d.ordenes.flatMap((o) =>
  o.lineas.map((l, i) => ({
    id_orden: o.id_orden, estado: "PENDIENTE", estado_normalizado: "PENDIENTE",
    numero_guia: null, transportadora: null, ciudad_destino: null, linea: i + 1,
    producto_id: l.producto_id, producto_nombre: nombres.get(l.producto_id)!,
    variacion_id: null, texto_variacion: null, unidades_extraidas: null, cantidad: l.cantidad,
  }))));
const conteoReporte = construirReporteOrdenado(lineas).conteoPorProducto;
check("mismos tipos, nombres y pedidos que las filas COMBO del Reporte Ordenado",
  combos.detalle,
  conteoReporte.filter((c) => c.tipo === "COMBO").map((c) => ({ nombre: c.producto, pedidos: c.pedidos })));
check("y las hojas de producto cuentan lo mismo que sus filas PRODUCTO",
  noviembre.hojas.map((h) => [h.producto.nombre, h.totalPedidos, h.totalUnidades]),
  conteoReporte.filter((c) => c.tipo === "PRODUCTO").map((c) => [c.producto, c.pedidos, c.unidades]));

console.log("\n── Un mes sin combos no tiene hoja Combos ──");
const { historial: diciembre, totales: totalesDiciembre } = await historialDe(2026, 12);
check("diciembre: combos = null", diciembre.combos, null);
check("solo hojas de producto", diciembre.hojas.map((h) => h.producto.nombre), ["AW chocolate", "Hydra"]);
check("la devolución normal cuenta en su producto",
  diciembre.hojas.find((h) => h.producto.id === 1)?.totalNoCompletados, 1);
check("suma de hojas = totales_diarios()",
  diciembre.totalPedidos, totalesDiciembre.reduce((n, t) => n + t.pedidos, 0));

/* ── Excel ──────────────────────────────────────────────────────────────── */
async function reabrir(h: HistorialMensual, nombre: string): Promise<ExcelJS.Workbook> {
  const ruta = path.join(tmpdir(), nombre);
  writeFileSync(ruta, Buffer.from((await generarExcelHistorialMensual(h)) as ArrayBuffer));
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.readFile(ruta);
  return libro;
}

console.log("\n── Excel: hoja Combos al final ──");
const libro = await reabrir(noviembre, "fullegacy-historial-combos.xlsx");
check("hojas: productos A→Z y Combos al final",
  libro.worksheets.map((h) => h.name), ["AW 839 azul", "AW chocolate", "Hydra", "Combos"]);

const hc = libro.getWorksheet("Combos")!;
const ENCABEZADO = 5; // 3 filas de banner + 1 en blanco
const valores = (fila: number, hasta = 5) =>
  Array.from({ length: hasta }, (_, i) => hc.getCell(fila, i + 1).value);

check("título del encabezado de marca", hc.getCell(1, 3).value, "Combos");
check("las mismas 5 columnas",
  valores(ENCABEZADO),
  ["DÍA", "PEDIDOS", "UNIDADES", "DEVOLUCIONES EN BODEGA", "NO COMPLETADOS (PRELIMINAR)"]);
check("día 5: 3 pedidos, unidades «—», devoluciones en blanco, 1 no completado",
  valores(ENCABEZADO + 5), [5, 3, "—", null, 1]);
check("UNIDADES es «—» en todas las filas",
  Array.from({ length: 30 }, (_, i) => hc.getCell(ENCABEZADO + 1 + i, 3).value).every((v) => v === "—"), true);
check("el jueves 5 va resaltado",
  (hc.getCell(ENCABEZADO + 5, 1).fill as ExcelJS.FillPattern | undefined)?.fgColor?.argb, "FFEDF2F8");
const filaTotal = ENCABEZADO + 30 + 1;
check("fila TOTAL", valores(filaTotal), ["TOTAL", 4, "—", null, 1]);
check("nota al pie debajo del total",
  String(hc.getCell(filaTotal + 2, 1).value).includes("jueves"), true);

const filaTituloDetalle = filaTotal + 4;
check("título del detalle", hc.getCell(filaTituloDetalle, 1).value, "Detalle de combos del mes");
check("encabezado del detalle",
  [hc.getCell(filaTituloDetalle + 1, 1).value, hc.getCell(filaTituloDetalle + 1, 5).value],
  ["TIPO DE COMBO", "PEDIDOS"]);
check("una fila por tipo de combo",
  [1, 2, 3].map((i) => [hc.getCell(filaTituloDetalle + 1 + i, 1).value, hc.getCell(filaTituloDetalle + 1 + i, 5).value]),
  combos.detalle.map((c) => [c.nombre, c.pedidos]));
check("total del detalle = total de la tabla diaria",
  [hc.getCell(filaTituloDetalle + 5, 1).value, hc.getCell(filaTituloDetalle + 5, 5).value], ["TOTAL", 4]);

const hojaAzul = libro.getWorksheet("AW 839 azul")!;
check("la hoja de producto muestra pedidos normales y todas las unidades (día 5)",
  [hojaAzul.getCell(ENCABEZADO + 5, 2).value, hojaAzul.getCell(ENCABEZADO + 5, 3).value], [0, 4]);

console.log("\n── Excel: mes sin combos ──");
const libroDiciembre = await reabrir(diciembre, "fullegacy-historial-sin-combos.xlsx");
check("sin hoja Combos", libroDiciembre.worksheets.map((h) => h.name), ["AW chocolate", "Hydra"]);

console.log("\n── Excel: mes con solo combos ──");
const soloCombos = construirHistorialPorOrden(2026, 11, productos, [
  { dia: 2, ordenes: [{ id_orden: 1, estado: "ENTREGADO", lineas: [{ producto_id: 1, cantidad: 1 }, { producto_id: 4, cantidad: 1 }] }] },
]);
const libroSoloCombos = await reabrir(soloCombos, "fullegacy-historial-solo-combos.xlsx");
check("no escribe la hoja de \"Sin movimiento\": solo Combos",
  libroSoloCombos.worksheets.map((h) => h.name), ["Combos"]);

console.log("\n── Un producto llamado \"Combos\" no choca con la hoja ──");
const conProductoCombos = construirHistorialPorOrden(2026, 11, [...productos, { id: 5, nombre: "Combos" }], [
  { dia: 2, ordenes: [
    { id_orden: 1, estado: "ENTREGADO", lineas: [{ producto_id: 5, cantidad: 1 }] },
    { id_orden: 2, estado: "ENTREGADO", lineas: [{ producto_id: 1, cantidad: 1 }, { producto_id: 2, cantidad: 1 }] },
  ] },
]);
const libroChoque = await reabrir(conProductoCombos, "fullegacy-historial-choque.xlsx");
check("el producto se numera, la hoja Combos conserva su nombre",
  libroChoque.worksheets.map((h) => h.name), ["Combos (2)", "Combos"]);

console.log(`\n${fallos === 0 ? "HISTORIAL CON COMBOS CORRECTO" : `${fallos} FALLOS`}`);
process.exit(fallos === 0 ? 0 : 1);
