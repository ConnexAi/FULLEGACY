import "server-only";

import type ExcelJS from "exceljs";

import {
  MARCA,
  agregarEncabezado,
  agregarNotaAlPie,
  crearLibro,
  escribirFilaTotales,
  escribirTabla,
  type ColumnaTabla,
} from "@/lib/excel/estilo-marca";
import {
  AVISO_PRELIMINAR,
  ESTADOS_NO_COMPLETADOS,
  type FilaDia,
  type HistorialMensual,
  type HojaProducto,
} from "@/lib/reportes/historial-mensual";

/** Excel no acepta estos caracteres en el nombre de una hoja, ni más de 31. */
const PROHIBIDOS_EN_HOJA = /[*?:\\/[\]]/g;
const MAX_NOMBRE_HOJA = 31;

const COLUMNAS: ColumnaTabla<FilaDia>[] = [
  { titulo: "DÍA", valor: (f) => f.dia, alineacion: "center", anchoMinimo: 7 },
  { titulo: "PEDIDOS", valor: (f) => f.pedidos, alineacion: "right", anchoMinimo: 10 },
  { titulo: "UNIDADES", valor: (f) => f.unidades, alineacion: "right", anchoMinimo: 10 },
  {
    titulo: "DEVOLUCIONES EN BODEGA",
    // Queda en blanco a propósito: la llena Diego a mano.
    valor: () => null,
    alineacion: "right",
    anchoMinimo: 16,
    nota: "Columna para llenar a mano. El sistema no la calcula.",
  },
  {
    titulo: "NO COMPLETADOS (PRELIMINAR)",
    valor: (f) => f.noCompletados,
    alineacion: "right",
    anchoMinimo: 16,
    nota: `${AVISO_PRELIMINAR}\n\nCuenta las órdenes despachadas cuyo estado quedó en: ${ESTADOS_NO_COMPLETADOS.join(", ")}.`,
  },
];

/**
 * Arma el historial mensual: un libro con una hoja por producto que tuvo
 * pedidos ese mes.
 *
 * Todas las hojas llevan el encabezado de marca del Sprint 2, así que el
 * archivo se ve igual que el Reporte Ordenado.
 *
 * Si ningún producto tuvo movimiento (mes futuro, o recién empezado), el libro
 * no se queda vacío: un .xlsx sin ninguna hoja no es un archivo válido para
 * Excel (Office lo rechaza o lo repara al abrir), así que se escribe una única
 * hoja de aviso en su lugar.
 */
export async function generarExcelHistorialMensual(
  historial: HistorialMensual,
): Promise<ExcelJS.Buffer> {
  const libro = crearLibro();
  const usados = new Set<string>();

  if (historial.hojas.length === 0) {
    await escribirHojaSinMovimiento(libro, historial.etiquetaMes);
  } else {
    for (const hoja of historial.hojas) {
      await escribirHojaProducto(libro, hoja, historial.etiquetaMes, usados);
    }
  }

  return libro.xlsx.writeBuffer();
}

async function escribirHojaSinMovimiento(
  libro: ExcelJS.Workbook,
  etiquetaMes: string,
): Promise<void> {
  const hoja = libro.addWorksheet("Sin movimiento");
  const columnasBanner = COLUMNAS.length;

  const filaMensaje = await agregarEncabezado(libro, hoja, {
    titulo: "Historial mensual",
    subtitulo: etiquetaMes,
    columnas: columnasBanner,
  });

  const celda = hoja.getCell(filaMensaje, 1);
  celda.value = `Ningún producto tuvo pedidos con fecha de guía generada en ${etiquetaMes}.`;
  celda.font = { name: "Calibri", size: 11, color: { argb: MARCA.texto } };
  celda.alignment = { vertical: "middle", wrapText: true };
  hoja.mergeCells(filaMensaje, 1, filaMensaje, columnasBanner);
}

async function escribirHojaProducto(
  libro: ExcelJS.Workbook,
  datos: HojaProducto,
  etiquetaMes: string,
  usados: Set<string>,
): Promise<void> {
  const hoja = libro.addWorksheet(nombreDeHoja(datos.producto.nombre, usados));

  const filaTabla = await agregarEncabezado(libro, hoja, {
    titulo: datos.producto.nombre,
    subtitulo: `Historial mensual · ${etiquetaMes}`,
    columnas: COLUMNAS.length,
  });

  escribirTabla(hoja, {
    filaEncabezado: filaTabla,
    columnas: COLUMNAS,
    filas: datos.filas,
    // Los jueves Diego manda fotos a sus clientes: los quiere ubicar de un
    // vistazo. Reemplaza la banda alterna, que acá no aporta (no hay grupos).
    fondoDeFila: (fila) => (fila.esJueves ? MARCA.resaltadoSuave : null),
  });

  const filaTotales = filaTabla + datos.filas.length + 1;
  escribirFilaTotales(hoja, {
    fila: filaTotales,
    columnas: COLUMNAS,
    // La de devoluciones va vacía: la llena Diego a mano, no se totaliza.
    valores: [
      "TOTAL",
      datos.totalPedidos,
      datos.totalUnidades,
      null,
      datos.totalNoCompletados,
    ],
  });

  agregarNotaAlPie(
    hoja,
    filaTotales + 2,
    `Fondo azul tenue = jueves.  ·  "No completados": ${AVISO_PRELIMINAR}`,
    COLUMNAS.length,
  );
}

/**
 * Nombre de hoja válido para Excel: sin caracteres prohibidos, máximo 31
 * caracteres y único dentro del libro.
 *
 * Hace falta de verdad: "KIT ALIVIO GARGANTA GUT Y ESPIRULINA" son 36.
 */
export function nombreDeHoja(nombreProducto: string, usados: Set<string>): string {
  const limpio =
    nombreProducto.replace(PROHIBIDOS_EN_HOJA, " ").replace(/\s+/g, " ").trim() ||
    "Producto";

  let candidato = limpio.slice(0, MAX_NOMBRE_HOJA);

  // Si dos productos comparten los primeros 31 caracteres, se numeran.
  for (let n = 2; usados.has(candidato.toLowerCase()); n += 1) {
    const sufijo = ` (${n})`;
    candidato = `${limpio.slice(0, MAX_NOMBRE_HOJA - sufijo.length)}${sufijo}`;
  }

  usados.add(candidato.toLowerCase());
  return candidato;
}

/** historial-2026-09.xlsx */
export function nombreArchivoHistorial(anio: number, mes: number): string {
  return `historial-${anio}-${String(mes).padStart(2, "0")}.xlsx`;
}
