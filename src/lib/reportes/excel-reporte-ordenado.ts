import "server-only";

import ExcelJS from "exceljs";

import {
  agregarEncabezado,
  crearLibro,
  escribirTabla,
  type ColumnaTabla,
} from "@/lib/excel/estilo-marca";
import type {
  FilaReporte,
  ConteoProducto,
  ReporteOrdenado,
} from "@/lib/reportes/reporte-ordenado";

const VACIO = "—";

/** Las mismas ocho columnas que se ven en pantalla, en el mismo orden. */
const COLUMNAS: ColumnaTabla<FilaReporte>[] = [
  { titulo: "TIPO", valor: (f) => f.tipo, anchoMinimo: 10 },
  { titulo: "PRODUCTO", valor: (f) => f.producto, anchoMinimo: 24 },
  { titulo: "VARIACION", valor: (f) => f.variacion, anchoMinimo: 12 },
  { titulo: "CANTIDAD", valor: (f) => f.cantidad, alineacion: "right", anchoMinimo: 10 },
  { titulo: "N GUIA", valor: (f) => f.numeroGuia ?? VACIO, anchoMinimo: 14 },
  { titulo: "ID ORDEN", valor: (f) => f.idOrden, alineacion: "right", anchoMinimo: 12 },
  { titulo: "TRANSPORTADORA", valor: (f) => f.transportadora ?? VACIO, anchoMinimo: 16 },
  { titulo: "CIUDAD DESTINO", valor: (f) => f.ciudadDestino ?? VACIO, anchoMinimo: 16 },
];

const COLUMNAS_CONTEO: ColumnaTabla<ConteoProducto>[] = [
  { titulo: "PRODUCTO", valor: (c) => c.producto, anchoMinimo: 24 },
  { titulo: "PEDIDOS", valor: (c) => c.pedidos, alineacion: "right", anchoMinimo: 10 },
  { titulo: "UNIDADES", valor: (c) => c.unidades, alineacion: "right", anchoMinimo: 10 },
];

export interface DatosArchivo {
  nombreArchivo: string;
  creadoEn: Date;
}

/**
 * Arma el Excel del Reporte Ordenado de una carga.
 *
 * El contenido y el orden son exactamente los que ya se ven en pantalla: el
 * reporte se construye una sola vez y se renderiza en los dos medios.
 */
export async function generarExcelReporteOrdenado(
  reporte: ReporteOrdenado,
  archivo: DatosArchivo,
): Promise<ExcelJS.Buffer> {
  const libro = crearLibro();
  const subtitulo = `${archivo.nombreArchivo} · ${formatearFecha(archivo.creadoEn)}`;

  // --- Hoja 1: el listado para despachar -------------------------------
  const hoja = libro.addWorksheet("Reporte Ordenado");

  const filaTabla = await agregarEncabezado(libro, hoja, {
    titulo: "Reporte Ordenado",
    subtitulo,
    columnas: COLUMNAS.length,
  });

  escribirTabla(hoja, {
    filaEncabezado: filaTabla,
    columnas: COLUMNAS,
    filas: reporte.filas,
    // Cada producto distinto cambia el tono de fondo.
    grupoDe: (fila) => fila.producto,
  });

  // --- Hoja 2: el conteo -----------------------------------------------
  //
  // Va en su propia hoja y no debajo de la tabla: comparten columnas, y el
  // ajuste automático de una terminaba deformando los anchos de la otra
  // (PRODUCTO del conteo cae sobre la columna TIPO del reporte).
  if (reporte.conteoPorProducto.length > 0) {
    const hojaConteo = libro.addWorksheet("Conteo por producto");

    const filaConteo = await agregarEncabezado(libro, hojaConteo, {
      titulo: "Conteo por producto",
      subtitulo,
      columnas: COLUMNAS_CONTEO.length,
    });

    escribirTabla(hojaConteo, {
      filaEncabezado: filaConteo,
      columnas: COLUMNAS_CONTEO,
      filas: reporte.conteoPorProducto,
    });
  }

  return libro.xlsx.writeBuffer();
}

/** Nombre sugerido: reporte-ordenado-2026-08-27.xlsx */
export function nombreArchivoExcel(creadoEn: Date): string {
  return `reporte-ordenado-${formatearFechaIso(creadoEn)}.xlsx`;
}

/** La fecha de la carga, en el día que corresponde en Colombia. */
function formatearFechaIso(fecha: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "America/Bogota",
  }).format(fecha);
}

function formatearFecha(fecha: Date): string {
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "America/Bogota",
  }).format(fecha);
}
