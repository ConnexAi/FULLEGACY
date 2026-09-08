/**
 * Genera el Excel del historial mensual y lo reabre para verificar el estilo
 * de marca, la marca de los jueves y el disclaimer de la columna preliminar.
 */
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import ExcelJS from "exceljs";

import { MARCA } from "@/lib/excel/estilo-marca";
import {
  generarExcelHistorialMensual,
  nombreArchivoHistorial,
  nombreDeHoja,
} from "@/lib/reportes/excel-historial-mensual";
import {
  AVISO_PRELIMINAR,
  construirHistorialMensual,
  type AgregadoDia,
} from "@/lib/reportes/historial-mensual";

let fallos = 0;
const check = (n: string, real: unknown, esp: unknown) => {
  const ok = JSON.stringify(real) === JSON.stringify(esp);
  if (!ok) fallos++;
  console.log(`${ok ? "  ok  " : "FALLA"} ${n}` +
    (ok ? "" : `\n        esperado: ${JSON.stringify(esp)}\n        real:     ${JSON.stringify(real)}`));
};

const productos = [
  { id: 1, nombre: "Hydra" },
  { id: 2, nombre: "KIT ALIVIO GARGANTA GUT Y ESPIRULINA" }, // 36 caracteres
  { id: 3, nombre: "Producto sin ventas" },
];
const agregados: AgregadoDia[] = [
  { producto_id: 1, dia: 3, pedidos: 2, unidades: 3, no_completados: 1 },
  { producto_id: 1, dia: 10, pedidos: 1, unidades: 1, no_completados: 0 },
  { producto_id: 2, dia: 5, pedidos: 4, unidades: 9, no_completados: 0 },
];

const historial = construirHistorialMensual(2026, 9, productos, agregados);
const buffer = await generarExcelHistorialMensual(historial);

const ruta = path.join(tmpdir(), "fullegacy-historial-prueba.xlsx");
writeFileSync(ruta, Buffer.from(buffer as ArrayBuffer));

const leido = new ExcelJS.Workbook();
await leido.xlsx.readFile(ruta);

/* ── Estructura ─────────────────────────────────────────────────────────── */
console.log("── Una hoja por producto ──");
check("firma ZIP de xlsx", Buffer.from(buffer as ArrayBuffer).subarray(0, 2).toString(), "PK");
check("tres hojas", leido.worksheets.length, 3);
check("nombradas por producto, A→Z",
  leido.worksheets.map((h) => h.name),
  ["Hydra", "KIT ALIVIO GARGANTA GUT Y ESPIR", "Producto sin ventas"]);
check("el nombre largo se recorta a los 31 de Excel",
  leido.worksheets[1].name.length, 31);

console.log("\n── Nombres de hoja duplicados ──");
const usados = new Set<string>();
check("dos productos con el mismo prefijo se numeran",
  [
    nombreDeHoja("KIT ALIVIO GARGANTA GUT Y ESPIRULINA", usados),
    nombreDeHoja("KIT ALIVIO GARGANTA GUT Y ESPIRULINA EXTRA", usados),
  ],
  ["KIT ALIVIO GARGANTA GUT Y ESPIR", "KIT ALIVIO GARGANTA GUT Y E (2)"]);
check("los caracteres prohibidos por Excel se limpian",
  nombreDeHoja("Combo A/B [x2]", new Set()), "Combo A B x2");

/* ── Estilo de marca ────────────────────────────────────────────────────── */
console.log("\n── Estilo de marca ──");
const hoja = leido.worksheets[0];
check("el logo está en cada hoja",
  leido.worksheets.map((h) => h.getImages().length), [1, 1, 1]);
check("una sola copia embebida en el libro", (leido.model.media ?? []).length, 1);
const bytes = leido.model.media?.[0]?.buffer as unknown as Uint8Array | undefined;
check("y es un PNG real", Buffer.from(bytes!).subarray(1, 4).toString(), "PNG");
check("banner crema arriba",
  (hoja.getCell(1, 1).fill as ExcelJS.FillPattern)?.fgColor?.argb, MARCA.crema);

let filaEnc = 0;
for (let i = 1; i <= hoja.rowCount; i++) {
  if (String(hoja.getRow(i).getCell(1).value ?? "") === "DÍA") { filaEnc = i; break; }
}
check("hay encabezado de tabla", filaEnc > 0, true);
check("las 5 columnas acordadas",
  Array.from({ length: 5 }, (_, j) => String(hoja.getRow(filaEnc).getCell(j + 1).value ?? "")),
  ["DÍA", "PEDIDOS", "UNIDADES", "DEVOLUCIONES EN BODEGA", "NO COMPLETADOS (PRELIMINAR)"]);
const celdaEnc = hoja.getRow(filaEnc).getCell(1);
check("encabezado azul, texto crema y negrita",
  [(celdaEnc.fill as ExcelJS.FillPattern)?.fgColor?.argb, celdaEnc.font?.color?.argb, celdaEnc.font?.bold],
  [MARCA.azul, MARCA.crema, true]);
check("encabezado congelado",
  hoja.views?.[0]?.state === "frozen" && hoja.views[0].ySplit === filaEnc, true);
check("todas las hojas congelan el suyo",
  leido.worksheets.every((h) => h.views?.[0]?.state === "frozen"), true);

/* ── Filas del mes ──────────────────────────────────────────────────────── */
console.log("\n── Filas: un día del mes cada una ──");
const filas: number[] = [];
for (let i = filaEnc + 1; i <= hoja.rowCount; i++) {
  const dia = hoja.getRow(i).getCell(1).value;
  if (typeof dia !== "number") break;
  filas.push(dia);
}
check("30 filas para septiembre", filas.length, 30);
check("del 1 al 30", [filas[0], filas.at(-1)], [1, 30]);
check("el día 3 trae sus valores",
  Array.from({ length: 5 }, (_, j) => hoja.getRow(filaEnc + 3).getCell(j + 1).value),
  [3, 2, 3, null, 1]);
check("la columna de devoluciones va vacía en todas las filas",
  filas.every((_, i) => hoja.getRow(filaEnc + 1 + i).getCell(4).value === null), true);
check("un producto sin ventas trae sus 30 días en cero",
  Array.from({ length: 30 }, (_, i) => leido.worksheets[2].getRow(filaEnc + 1 + i).getCell(2).value)
    .every((v) => v === 0), true);

/* ── Jueves ─────────────────────────────────────────────────────────────── */
console.log("\n── Marca visual en los jueves ──");
const fondoDia = (dia: number) =>
  ((hoja.getRow(filaEnc + dia).getCell(1).fill as ExcelJS.FillPattern)?.fgColor?.argb) ?? null;
check("los jueves 3, 10, 17 y 24 llevan el resaltado",
  [3, 10, 17, 24].map(fondoDia),
  Array(4).fill(MARCA.resaltadoSuave));
check("los demás días no",
  [1, 2, 4, 5, 11, 25, 30].map(fondoDia), Array(7).fill(null));

/* ── Disclaimer ─────────────────────────────────────────────────────────── */
console.log("\n── Aviso de la columna preliminar ──");
const notaEncabezado = hoja.getRow(filaEnc).getCell(5).note;
const textoNota = typeof notaEncabezado === "string"
  ? notaEncabezado
  : (notaEncabezado?.texts ?? []).map((t) => t.text).join("");
check("la celda del encabezado lleva un comentario", textoNota.includes(AVISO_PRELIMINAR), true);
check("y nombra los estados que cuenta", textoNota.includes("DEVOLUCION"), true);
check("la columna de devoluciones también se explica",
  String(hoja.getRow(filaEnc).getCell(4).note ?? JSON.stringify(hoja.getRow(filaEnc).getCell(4).note)).includes("mano"), true);

let pie = "";
for (let i = filaEnc + 31; i <= hoja.rowCount; i++) {
  const v = String(hoja.getRow(i).getCell(1).value ?? "");
  if (v.includes("jueves")) { pie = v; break; }
}
check("hay nota al pie visible con el aviso", pie.includes(AVISO_PRELIMINAR), true);
check("y explica el color de los jueves", pie.includes("jueves"), true);

/* ── Totales y nombre ───────────────────────────────────────────────────── */
console.log("\n── Totales y nombre del archivo ──");
let filaTotal = 0;
for (let i = filaEnc + 1; i <= hoja.rowCount; i++) {
  if (String(hoja.getRow(i).getCell(1).value ?? "") === "TOTAL") { filaTotal = i; break; }
}
check("fila de totales",
  Array.from({ length: 5 }, (_, j) => hoja.getRow(filaTotal).getCell(j + 1).value),
  ["TOTAL", 3, 4, null, 1]);
check("nombre del archivo", nombreArchivoHistorial(2026, 9), "historial-2026-09.xlsx");
check("mes de un dígito con cero", nombreArchivoHistorial(2026, 1), "historial-2026-01.xlsx");

console.log(`\n${fallos === 0 ? "EXCEL DEL HISTORIAL CORRECTO" : `${fallos} FALLOS`}`);
console.log(`(archivo en ${ruta})`);
process.exit(fallos ? 1 : 0);
