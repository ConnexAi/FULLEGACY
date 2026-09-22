import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import ExcelJS from "exceljs";

/**
 * Identidad de marca de FULLEGACY aplicada a los Excel que descarga Diego.
 *
 * Vive aparte del reporte que lo usa porque el historial mensual del Sprint 3
 * necesita exactamente el mismo encabezado y la misma tabla.
 *
 * Los colores van en ARGB, que es lo que espera ExcelJS.
 */
export const MARCA = {
  azul: "FF3B6EA5",
  dorado: "FFC9A227",
  crema: "FFFDF6E3",
  /** Banda alterna: apenas más oscura que el blanco, para separar grupos. */
  bandaAlterna: "FFF7F3EA",
  /** Resaltado tenue derivado del azul de marca, para marcar filas puntuales. */
  resaltadoSuave: "FFEDF2F8",
  blanco: "FFFFFFFF",
  texto: "FF1F2937",
  textoSuave: "FF6B7280",
  borde: "FFE7E1D3",
} as const;

/**
 * El logo ya recortado a su contenido (sin el margen crema del original), para
 * que quepa legible en las tres filas del encabezado.
 */
const RUTA_LOGO = "public/logo-fullegacy-marca.png";
const LOGO_ANCHO_PX = 163;
const LOGO_ALTO_PX = 88;

/** Filas que ocupa el encabezado de marca antes de la tabla. */
const FILAS_BANNER = 3;

let logoEnCache: Buffer | null = null;

/**
 * Id de la imagen ya registrada en cada libro.
 *
 * `addImage` embebe los bytes cada vez que se llama: sin esto, un libro de dos
 * hojas cargaría el logo dos veces y el archivo pesaría el doble.
 */
const logoPorLibro = new WeakMap<ExcelJS.Workbook, number>();

/**
 * Lee el logo del disco.
 *
 * En Vercel `public/` no entra solo al bundle de una función serverless: se
 * fuerza con `outputFileTracingIncludes` en next.config.ts.
 */
async function leerLogo(): Promise<Buffer> {
  if (!logoEnCache) {
    logoEnCache = await readFile(path.join(process.cwd(), RUTA_LOGO));
  }
  return logoEnCache;
}

export function crearLibro(): ExcelJS.Workbook {
  const libro = new ExcelJS.Workbook();
  libro.creator = "FULLEGACY";
  libro.created = new Date();
  return libro;
}

export interface OpcionesEncabezado {
  titulo: string;
  subtitulo?: string;
  /** Cuántas columnas ocupa la tabla, para que el banner las cubra. */
  columnas: number;
}

/**
 * Escribe el encabezado de marca: banda crema con el logo a la izquierda y el
 * título a la derecha.
 *
 * El fondo crema es el mismo del logo, así que la imagen se funde con la banda
 * en vez de verse como un recuadro pegado encima.
 *
 * Devuelve la primera fila libre debajo del encabezado.
 */
export async function agregarEncabezado(
  libro: ExcelJS.Workbook,
  hoja: ExcelJS.Worksheet,
  { titulo, subtitulo, columnas }: OpcionesEncabezado,
): Promise<number> {
  let idLogo = logoPorLibro.get(libro);
  if (idLogo === undefined) {
    idLogo = libro.addImage({
      buffer: (await leerLogo()) as unknown as ExcelJS.Buffer,
      extension: "png",
    });
    logoPorLibro.set(libro, idLogo);
  }

  for (let fila = 1; fila <= FILAS_BANNER; fila += 1) {
    hoja.getRow(fila).height = 22;
    for (let columna = 1; columna <= columnas; columna += 1) {
      hoja.getCell(fila, columna).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: MARCA.crema },
      };
    }
  }

  hoja.addImage(idLogo, {
    tl: { col: 0.25, row: 0.2 },
    ext: { width: LOGO_ANCHO_PX, height: LOGO_ALTO_PX },
    editAs: "oneCell",
  });

  // El título va sobre la mitad derecha para no chocar con el logo, que flota
  // sobre las primeras columnas.
  const inicioTitulo = Math.max(3, Math.floor(columnas / 2) + 1);

  if (inicioTitulo < columnas) {
    hoja.mergeCells(1, inicioTitulo, 1, columnas);
    hoja.mergeCells(2, inicioTitulo, 2, columnas);
  }

  const celdaTitulo = hoja.getCell(1, inicioTitulo);
  celdaTitulo.value = titulo;
  celdaTitulo.font = { name: "Calibri", size: 14, bold: true, color: { argb: MARCA.azul } };
  celdaTitulo.alignment = { horizontal: "right", vertical: "middle" };

  if (subtitulo) {
    const celdaSub = hoja.getCell(2, inicioTitulo);
    celdaSub.value = subtitulo;
    celdaSub.font = { name: "Calibri", size: 10, color: { argb: MARCA.dorado } };
    celdaSub.alignment = { horizontal: "right", vertical: "middle" };
  }

  // Fila en blanco entre el banner y la tabla.
  return FILAS_BANNER + 2;
}

export type Alineacion = "left" | "right" | "center";

export interface ColumnaTabla<T> {
  titulo: string;
  valor: (fila: T) => string | number | null;
  alineacion?: Alineacion;
  /** Ancho mínimo en caracteres; el ajuste automático nunca baja de acá. */
  anchoMinimo?: number;
  /** Comentario en la celda del encabezado (aclaraciones, advertencias). */
  nota?: string;
}

export interface OpcionesTabla<T> {
  filaEncabezado: number;
  columnas: ColumnaTabla<T>[];
  filas: T[];
  /**
   * Clave de agrupación. Cada vez que cambia, se alterna el tono de fondo:
   * así se distingue de un vistazo dónde empieza cada producto.
   */
  grupoDe?: (fila: T) => string;
  /**
   * Color de fondo propio de una fila (ARGB). Tiene prioridad sobre la banda
   * alterna: sirve para destacar filas puntuales, como los jueves del mes.
   */
  fondoDeFila?: (fila: T) => string | null;
}

/**
 * Escribe la tabla con el estilo de marca: encabezado azul, bandas alternas
 * por grupo, anchos ajustados y encabezado congelado.
 *
 * Devuelve la primera fila libre debajo de la tabla.
 */
export function escribirTabla<T>(
  hoja: ExcelJS.Worksheet,
  { filaEncabezado, columnas, filas, grupoDe, fondoDeFila }: OpcionesTabla<T>,
): number {
  const encabezado = hoja.getRow(filaEncabezado);
  encabezado.height = 20;

  columnas.forEach((columna, i) => {
    const celda = encabezado.getCell(i + 1);
    celda.value = columna.titulo;
    celda.font = { name: "Calibri", size: 10, bold: true, color: { argb: MARCA.crema } };
    celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: MARCA.azul } };
    celda.alignment = {
      horizontal: columna.alineacion ?? "left",
      vertical: "middle",
      wrapText: true,
    };
    celda.border = { bottom: { style: "thin", color: { argb: MARCA.azul } } };

    if (columna.nota) {
      celda.note = columna.nota;
    }
  });

  let grupoAnterior: string | null = null;
  let bandaOscura = false;

  filas.forEach((fila, i) => {
    if (grupoDe) {
      const grupo = grupoDe(fila);
      if (grupoAnterior !== null && grupo !== grupoAnterior) bandaOscura = !bandaOscura;
      grupoAnterior = grupo;
    }

    const filaExcel = hoja.getRow(filaEncabezado + 1 + i);

    columnas.forEach((columna, j) => {
      const celda = filaExcel.getCell(j + 1);
      celda.value = columna.valor(fila);
      celda.font = { name: "Calibri", size: 10, color: { argb: MARCA.texto } };
      celda.alignment = {
        horizontal: columna.alineacion ?? "left",
        vertical: "middle",
      };
      celda.border = { bottom: { style: "hair", color: { argb: MARCA.borde } } };

      const propio = fondoDeFila?.(fila) ?? null;
      const fondo = propio ?? (bandaOscura ? MARCA.bandaAlterna : null);

      if (fondo) {
        celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fondo } };
      }
    });
  });

  ajustarAnchos(hoja, columnas, filas);

  // Con el encabezado congelado, Diego puede recorrer 1600 filas sin perder
  // de vista qué columna está mirando.
  hoja.views = [{ state: "frozen", ySplit: filaEncabezado }];

  return filaEncabezado + filas.length + 1;
}

/** ExcelJS no tiene autoajuste: se calcula con el contenido más largo. */
function ajustarAnchos<T>(
  hoja: ExcelJS.Worksheet,
  columnas: ColumnaTabla<T>[],
  filas: T[],
): void {
  const MAXIMO = 46;

  columnas.forEach((columna, i) => {
    let largo = columna.titulo.length;

    for (const fila of filas) {
      const valor = columna.valor(fila);
      if (valor === null) continue;
      const texto = String(valor);
      if (texto.length > largo) largo = texto.length;
    }

    const columnaExcel = hoja.getColumn(i + 1);
    const calculado = Math.min(MAXIMO, Math.max(columna.anchoMinimo ?? 8, largo + 3));

    // Solo ensancha: si otra tabla de la misma hoja ya pidió más, se respeta.
    columnaExcel.width = Math.max(columnaExcel.width ?? 0, calculado);
  });
}

export interface OpcionesFilaTotales<T> {
  fila: number;
  /** Las mismas columnas de la tabla: de ahí sale la alineación de cada celda. */
  columnas: ColumnaTabla<T>[];
  /**
   * Un valor por columna, en el mismo orden. `null` (o faltante) deja la celda
   * vacía pero conservando el borde, para que la línea cruce toda la tabla.
   */
  valores: (string | number | null)[];
}

/**
 * Fila de totales al pie de una tabla: negrita en azul de marca y una línea
 * fina arriba que la separa de los datos.
 *
 * Cada celda hereda la alineación de su columna, así que el rótulo queda
 * alineado como el resto de esa columna y los números siguen a la derecha.
 *
 * Devuelve la primera fila libre debajo.
 */
export function escribirFilaTotales<T>(
  hoja: ExcelJS.Worksheet,
  { fila, columnas, valores }: OpcionesFilaTotales<T>,
): number {
  const filaExcel = hoja.getRow(fila);

  columnas.forEach((columna, i) => {
    const celda = filaExcel.getCell(i + 1);
    celda.value = valores[i] ?? null;
    celda.font = { name: "Calibri", size: 10, bold: true, color: { argb: MARCA.azul } };
    celda.alignment = {
      horizontal: columna.alineacion ?? "left",
      vertical: "middle",
    };
    celda.border = { top: { style: "thin", color: { argb: MARCA.azul } } };
  });

  return fila + 1;
}

/** Nota al pie: aclaraciones que Diego debe leer antes de usar el dato. */
export function agregarNotaAlPie(
  hoja: ExcelJS.Worksheet,
  fila: number,
  texto: string,
  columnas: number,
): number {
  if (columnas > 1) hoja.mergeCells(fila, 1, fila, columnas);

  const celda = hoja.getCell(fila, 1);
  celda.value = texto;
  celda.font = { name: "Calibri", size: 9, italic: true, color: { argb: MARCA.textoSuave } };
  celda.alignment = { horizontal: "left", vertical: "middle", wrapText: true };

  return fila + 1;
}

/** Título de sección dentro de una hoja (ej. el conteo bajo la tabla). */
export function agregarTitulo(
  hoja: ExcelJS.Worksheet,
  fila: number,
  texto: string,
): number {
  const celda = hoja.getCell(fila, 1);
  celda.value = texto;
  celda.font = { name: "Calibri", size: 12, bold: true, color: { argb: MARCA.azul } };
  hoja.getRow(fila).height = 20;
  return fila + 1;
}
