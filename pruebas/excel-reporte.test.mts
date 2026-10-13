/**
 * Genera el Excel del Reporte Ordenado y lo vuelve a abrir con ExcelJS para
 * verificar que es un xlsx válido, con las filas correctas y el logo dentro.
 */
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import ExcelJS from "exceljs";

import { MARCA } from "@/lib/excel/estilo-marca";
import {
  generarExcelReporteOrdenado,
  nombreArchivoExcel,
} from "@/lib/reportes/excel-reporte-ordenado";
import {
  construirReporteOrdenado,
  type LineaCarga,
} from "@/lib/reportes/reporte-ordenado";

let fallos = 0;
const check = (n: string, real: unknown, esp: unknown) => {
  const ok = JSON.stringify(real) === JSON.stringify(esp);
  if (!ok) fallos++;
  console.log(`${ok ? "  ok  " : "FALLA"} ${n}` +
    (ok ? "" : `\n        esperado: ${JSON.stringify(esp)}\n        real:     ${JSON.stringify(real)}`));
};

let sig = 1;
const linea = (p: Partial<LineaCarga> & { producto_nombre: string }): LineaCarga => ({
  id_orden: 80000000 + sig++, estado: "PENDIENTE", estado_normalizado: "PENDIENTE",
  numero_guia: null, transportadora: "ENVIA", ciudad_destino: "BOGOTA",
  linea: 1, producto_id: 1, variacion_id: null, texto_variacion: null,
  unidades_extraidas: null, cantidad: 1, ...p,
});

const reporte = construirReporteOrdenado([
  linea({ producto_nombre: "Detox hepático", cantidad: 1 }),
  linea({ producto_nombre: "Detox hepático", cantidad: 2, ciudad_destino: "CARTAGENA" }),
  linea({ producto_nombre: "Hydra", producto_id: 2, variacion_id: 9, texto_variacion: "1 unidad", unidades_extraidas: 1 }),
  linea({ producto_nombre: "Waggy pet", producto_id: 3, cantidad: 3, transportadora: "INTERRAPIDISIMO" }),
  // combo: dos productos en la misma orden
  linea({ id_orden: 90000001, linea: 1, producto_nombre: "Dije Carmen", producto_id: 4 }),
  linea({ id_orden: 90000001, linea: 2, producto_nombre: "Pulsera dubai", producto_id: 5, cantidad: 2 }),
  // esta NO debe salir: no es PENDIENTE
  linea({ producto_nombre: "Focus men", producto_id: 6, estado_normalizado: "ENTREGADO" }),
]);

const creadoEn = new Date("2026-08-27T18:30:00Z");
const buffer = await generarExcelReporteOrdenado(reporte, {
  nombreArchivo: "ordenes_productos_20260827.xlsx",
  creadoEn,
});

const ruta = path.join(tmpdir(), "fullegacy-reporte-prueba.xlsx");
writeFileSync(ruta, Buffer.from(buffer as ArrayBuffer));

/* ── Se relee como xlsx de verdad ────────────────────────────────────────── */
console.log("── El archivo es un xlsx válido ──");
const leido = new ExcelJS.Workbook();
await leido.xlsx.readFile(ruta);
check("tiene dos hojas", leido.worksheets.map(h => h.name), ["Reporte Ordenado", "Conteo por producto"]);
const hoja = leido.worksheets[0];
check("firma ZIP de xlsx (PK)", Buffer.from(buffer as ArrayBuffer).subarray(0, 2).toString(), "PK");

/* ── Logo ───────────────────────────────────────────────────────────────── */
console.log("\n── El logo quedó insertado ──");
const imagenes = hoja.getImages();
check("hay exactamente una imagen en el reporte", imagenes.length, 1);
check("y otra en la hoja de conteo", leido.worksheets[1].getImages().length, 1);
const media = leido.model.media ?? [];
check("el medio es un png", media[0]?.extension, "png");
const bytesLogo = media[0]?.buffer as unknown as Uint8Array | undefined;
check("trae bytes de imagen", (bytesLogo?.length ?? 0) > 1000, true);
check("es un PNG real (firma)",
  Buffer.from(bytesLogo!).subarray(1, 4).toString(), "PNG");
check("anclado arriba a la izquierda",
  [Math.floor(Number(imagenes[0].range.tl.col)), Math.floor(Number(imagenes[0].range.tl.row))], [0, 0]);

/* ── Filas ──────────────────────────────────────────────────────────────── */
console.log("\n── Número de filas ──");
check("el reporte tiene 5 filas (4 normales + 1 combo)", reporte.filas.length, 5);

// Encontrar la fila de encabezado de la tabla principal.
let filaEncabezado = 0;
for (let i = 1; i <= hoja.rowCount; i++) {
  if (String(hoja.getRow(i).getCell(1).value ?? "") === "TIPO") { filaEncabezado = i; break; }
}
check("hay una fila de encabezado TIPO", filaEncabezado > 0, true);
check("los 8 títulos de columna",
  Array.from({ length: 8 }, (_, i) => String(hoja.getRow(filaEncabezado).getCell(i + 1).value ?? "")),
  ["TIPO","PRODUCTO","VARIACION","CANTIDAD","N GUIA","ID ORDEN","TRANSPORTADORA","CIUDAD DESTINO"]);

const filasDatos: string[][] = [];
for (let i = filaEncabezado + 1; i <= hoja.rowCount; i++) {
  const tipo = String(hoja.getRow(i).getCell(1).value ?? "");
  if (tipo !== "NORMAL" && tipo !== "COMBO") break;
  filasDatos.push(Array.from({ length: 8 }, (_, j) => String(hoja.getRow(i).getCell(j + 1).value ?? "")));
}
check("el Excel tiene tantas filas de datos como el reporte",
  filasDatos.length, reporte.filas.length);
check("y en el mismo orden",
  filasDatos.map((f) => f[1]), reporte.filas.map((f) => f.producto));
check("la orden ENTREGADO no aparece",
  filasDatos.some((f) => f[1] === "Focus men"), false);
check("el combo va en una fila con sus dos productos",
  filasDatos.filter((f) => f[0] === "COMBO").map((f) => f[1]),
  ["COMBO · Dije Carmen (1) + Pulsera dubai (2)"]);

/* ── Estilo ─────────────────────────────────────────────────────────────── */
console.log("\n── Estilo de marca ──");
const celdaEnc = hoja.getRow(filaEncabezado).getCell(1);
check("encabezado con fondo azul",
  (celdaEnc.fill as ExcelJS.FillPattern)?.fgColor?.argb, MARCA.azul);
check("texto del encabezado en crema y negrita",
  [celdaEnc.font?.color?.argb, celdaEnc.font?.bold], [MARCA.crema, true]);
check("banner crema arriba",
  (hoja.getCell(1, 1).fill as ExcelJS.FillPattern)?.fgColor?.argb, MARCA.crema);
check("encabezado congelado",
  hoja.views?.[0]?.state === "frozen" && hoja.views[0].ySplit === filaEncabezado, true);
check("anchos de columna ajustados (ninguno por defecto)",
  Array.from({ length: 8 }, (_, i) => (hoja.getColumn(i + 1).width ?? 0) > 8).every(Boolean), true);

// Bandas alternas: el fondo debe cambiar al cambiar de producto.
const fondo = (f: number) =>
  ((hoja.getRow(f).getCell(1).fill as ExcelJS.FillPattern)?.fgColor?.argb) ?? null;
const fondos = filasDatos.map((_, i) => fondo(filaEncabezado + 1 + i));
check("hay dos tonos alternados entre grupos", new Set(fondos).size, 2);
check("las dos filas del mismo producto comparten tono", fondos[0] === fondos[1], true);
check("y la del producto siguiente cambia", fondos[1] === fondos[2], false);

/* ── Nombre del archivo ─────────────────────────────────────────────────── */
console.log("\n── Nombre del archivo ──");
check("incluye la fecha de la carga",
  nombreArchivoExcel(creadoEn), "reporte-ordenado-2026-08-27.xlsx");
// 27/08 18:30 UTC = 13:30 en Bogotá, mismo día.
check("usa el día colombiano, no el UTC",
  nombreArchivoExcel(new Date("2026-08-28T02:00:00Z")), "reporte-ordenado-2026-08-27.xlsx");

/* ── Conteo ─────────────────────────────────────────────────────────────── */
console.log("\n── Hoja de conteo por producto ──");
const hojaConteo = leido.worksheets[1];
let filaConteo = 0;
for (let i = 1; i <= hojaConteo.rowCount; i++) {
  if (String(hojaConteo.getRow(i).getCell(1).value ?? "") === "PRODUCTO") { filaConteo = i; break; }
}
check("tiene su encabezado",
  Array.from({ length: 3 }, (_, j) => String(hojaConteo.getRow(filaConteo).getCell(j + 1).value ?? "")),
  ["PRODUCTO", "PEDIDOS", "UNIDADES"]);
check("una fila por cada fila del conteo, más la de Total",
  hojaConteo.rowCount - filaConteo, reporte.conteoPorProducto.length + 1);

// La fila de combo: va después de los productos y lleva UNIDADES vacío,
// porque sus unidades ya están contadas en las filas de los productos.
const filasConteo = Array.from(
  { length: reporte.conteoPorProducto.length },
  (_, i) => Array.from({ length: 3 }, (_, j) =>
    hojaConteo.getRow(filaConteo + 1 + i).getCell(j + 1).value),
);
check("las filas, tal como quedan en la hoja",
  filasConteo,
  [
    ["Detox hepático", 2, 3],
    ["Hydra", 1, 1],
    ["Waggy pet", 1, 3],
    ["COMBO · Dije Carmen (1) + Pulsera dubai (2)", 1, "—"],
  ]);
check("el combo va al final, antes del Total",
  String(filasConteo.at(-1)![0]).startsWith("COMBO · "), true);
check("y su celda de UNIDADES lleva el guion, no un cero",
  filasConteo.at(-1)![2], "—");

/* ── La fila de Total, igual que en pantalla ────────────────────────────── */
console.log("\n── La hoja de conteo cierra con la fila de Total ──");
const filaTotal = filaConteo + reporte.conteoPorProducto.length + 1;
const celdasTotal = Array.from({ length: 3 }, (_, j) =>
  hojaConteo.getRow(filaTotal).getCell(j + 1));

check("va justo debajo del último producto, sin fila en blanco",
  String(hojaConteo.getRow(filaTotal - 1).getCell(1).value ?? ""),
  reporte.conteoPorProducto.at(-1)!.producto);
check("el rótulo dice Total, como en la web",
  String(celdasTotal[0].value ?? ""), "Total");
check("PEDIDOS = el total de órdenes del reporte",
  celdasTotal[1].value, reporte.totalPedidos);
check("UNIDADES = el total de unidades del reporte",
  celdasTotal[2].value, reporte.totalUnidades);
// 5 órdenes PENDIENTE; unidades 1 + 2 + 1 + 3 + (1+2 del combo) = 10.
check("y esos valores son los que muestra la pantalla",
  [reporte.totalPedidos, reporte.totalUnidades], [5, 10]);

// PEDIDOS ahora cuadra exactamente: cada orden cuenta en una sola fila, la de
// su producto si es normal o la de su tipo de combo si no. Era al revés antes
// del cambio, y es el descuadre que Diego veía (79 contra 78).
check("PEDIDOS coincide con la suma de la columna",
  reporte.conteoPorProducto.reduce((n, c) => n + c.pedidos, 0),
  reporte.totalPedidos);
// UNIDADES no tiene por qué: Dije Carmen y Pulsera dubai solo aparecen dentro
// del combo, así que no tienen fila y sus 3 unidades están en el Total y en
// ninguna fila. La diferencia es correcta.
check("UNIDADES: el Total es mayor por los productos que solo vienen en combo",
  [
    reporte.conteoPorProducto.reduce((n, c) => n + (c.unidades ?? 0), 0),
    reporte.totalUnidades,
  ],
  [7, 10]);

console.log("\n── Estilo de la fila de Total ──");
check("negrita en azul de marca, como el resto de los totales",
  celdasTotal.map((c) => [c.font?.bold, c.font?.color?.argb]),
  Array(3).fill([true, MARCA.azul]));
check("línea fina arriba, que la separa de los datos",
  celdasTotal.map((c) => c.border?.top?.style),
  Array(3).fill("thin"));
check("hereda la alineación de cada columna: rótulo a la izquierda, números a la derecha",
  celdasTotal.map((c) => c.alignment?.horizontal),
  ["left", "right", "right"]);

/* ── Los anchos de una hoja no deforman la otra ─────────────────────────── */
console.log("\n── El conteo no deforma los anchos del reporte ──");
check("la columna TIPO queda angosta, no del ancho de un nombre de producto",
  (hoja.getColumn(1).width ?? 0) <= 14, true);
check("PRODUCTO del reporte sí es ancha", (hoja.getColumn(2).width ?? 0) >= 20, true);

/* ── El Excel de la foto se distingue del de en vivo ────────────────────── */
//
// El archivo descargado se despega de la pantalla donde se pidió: dos xlsx del
// mismo día en la carpeta de Descargas, uno con el estado de hoy y otro con el
// del martes, tienen que poder distinguirse sin abrirlos.
console.log("\n── Vista histórica: el archivo lo dice desde el nombre ──");

check("el nombre marca la foto",
  nombreArchivoExcel(creadoEn, "original"),
  "reporte-ordenado-como-se-subio-2026-08-27.xlsx");
check("y el de en vivo no cambió",
  nombreArchivoExcel(creadoEn, "vivo"), "reporte-ordenado-2026-08-27.xlsx");

const bufferFoto = await generarExcelReporteOrdenado(reporte, {
  nombreArchivo: "ordenes_productos_20260827.xlsx",
  creadoEn,
  vista: "original",
});
const rutaFoto = path.join(tmpdir(), "fullegacy-reporte-foto-prueba.xlsx");
writeFileSync(rutaFoto, Buffer.from(bufferFoto as ArrayBuffer));
const leidoFoto = new ExcelJS.Workbook();
await leidoFoto.xlsx.readFile(rutaFoto);

/**
 * El texto del banner de una hoja: título y subtítulo.
 *
 * Se barren las columnas porque el título no arranca en la primera: las de la
 * izquierda las ocupa el logo.
 */
const encabezadoDe = (h: ExcelJS.Worksheet) =>
  Array.from({ length: 3 }, (_, f) =>
    Array.from({ length: 10 }, (_, c) =>
      String(h.getRow(f + 1).getCell(c + 1).value ?? "")).join(" "),
  ).join(" | ");

const cabeceraFoto = encabezadoDe(leidoFoto.worksheets[0]);
check("el título dice que es la foto del archivo",
  cabeceraFoto.includes("foto del archivo"), true);
check("y el subtítulo avisa que NO es el estado de hoy",
  cabeceraFoto.includes("NO es el estado de hoy"), true);
check("el de en vivo dice lo contrario",
  encabezadoDe(hoja).includes("Estado de ahora"), true);
check("y no se hace pasar por foto",
  encabezadoDe(hoja).includes("foto del archivo"), false);

console.log(`\n${fallos === 0 ? "EXCEL CORRECTO" : `${fallos} FALLOS`}`);
console.log(`(archivo de prueba en ${ruta})`);
process.exit(fallos ? 1 : 0);
