import "server-only";

import ExcelJS from "exceljs";

import {
  agregarEncabezado,
  crearLibro,
  escribirFilaTotales,
  escribirTabla,
  type ColumnaTabla,
} from "@/lib/excel/estilo-marca";
import type {
  FilaReporte,
  ConteoProducto,
  ReporteOrdenado,
} from "@/lib/reportes/reporte-ordenado";
import { VISTA_POR_DEFECTO, type VistaReporte } from "@/lib/reportes/vista";

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
  /**
   * Qué lectura se está descargando. Va en el título, en el subtítulo y en el
   * nombre del archivo: una vez descargado el Excel se despega de la pantalla
   * donde se pidió, y una foto vieja confundida con el estado de hoy hace que
   * se alisten pedidos que ya salieron.
   */
  vista?: VistaReporte;
}

/** Título y aclaración de cada vista, tal como entran en la hoja. */
const ENCABEZADO_VISTA: Record<VistaReporte, { titulo: string; nota: string }> = {
  vivo: {
    titulo: "Reporte Ordenado",
    nota: "Estado de ahora",
  },
  original: {
    titulo: "Reporte Ordenado — foto del archivo",
    nota: "Como se subió originalmente · NO es el estado de hoy",
  },
};

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
  const vista = archivo.vista ?? VISTA_POR_DEFECTO;
  const { titulo, nota } = ENCABEZADO_VISTA[vista];
  const subtitulo = `${archivo.nombreArchivo} · ${formatearFecha(archivo.creadoEn)} · ${nota}`;

  // --- Hoja 1: el listado para despachar -------------------------------
  const hoja = libro.addWorksheet("Reporte Ordenado");

  const filaTabla = await agregarEncabezado(libro, hoja, {
    titulo,
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

    const filaTotales = escribirTabla(hojaConteo, {
      filaEncabezado: filaConteo,
      columnas: COLUMNAS_CONTEO,
      filas: reporte.conteoPorProducto,
    });

    // La misma fila de Total que cierra la tabla en pantalla. Ojo con PEDIDOS:
    // es el total de órdenes del reporte, así que una orden-combo cuenta una
    // sola vez aunque aparezca en la fila de cada producto que la compone —
    // por eso puede dar menos que la suma de la columna. UNIDADES sí coincide
    // con la suma, porque cada línea pertenece a un único producto.
    escribirFilaTotales(hojaConteo, {
      fila: filaTotales,
      columnas: COLUMNAS_CONTEO,
      valores: ["Total", reporte.totalPedidos, reporte.totalUnidades],
    });
  }

  return libro.xlsx.writeBuffer();
}

/**
 * Nombre sugerido: reporte-ordenado-2026-08-27.xlsx, o bien
 * reporte-ordenado-como-se-subio-2026-08-27.xlsx para la foto.
 *
 * Los dos archivos se distinguen por el nombre a propósito: si no, quedarían
 * uno al lado del otro en Descargas sin forma de saber cuál es cuál.
 */
export function nombreArchivoExcel(
  creadoEn: Date,
  vista: VistaReporte = VISTA_POR_DEFECTO,
): string {
  const marca = vista === "original" ? "como-se-subio-" : "";
  return `reporte-ordenado-${marca}${formatearFechaIso(creadoEn)}.xlsx`;
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
