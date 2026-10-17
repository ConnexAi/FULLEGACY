import "server-only";

import type ExcelJS from "exceljs";

import {
  MARCA,
  agregarEncabezado,
  agregarNotaAlPie,
  agregarTitulo,
  crearLibro,
  escribirFilaTotales,
  escribirTabla,
  type ColumnaTabla,
} from "@/lib/excel/estilo-marca";
import {
  AVISO_PRELIMINAR,
  ESTADOS_NO_COMPLETADOS,
  type FilaComboPorDia,
  type FilaDia,
  type FilaDiaCombos,
  type HistorialMensual,
  type HojaCombos,
  type HojaProducto,
} from "@/lib/reportes/historial-mensual";
import type { ConteoCombo } from "@/lib/reportes/reporte-ordenado";

/** Excel no acepta estos caracteres en el nombre de una hoja, ni más de 31. */
const PROHIBIDOS_EN_HOJA = /[*?:\\/[\]]/g;
const MAX_NOMBRE_HOJA = 31;

/** Marcador de celda sin valor, como en el Reporte Ordenado. */
const VACIO = "—";

const NOTA_DEVOLUCIONES = "Columna para llenar a mano. El sistema no la calcula.";
const NOTA_NO_COMPLETADOS = `${AVISO_PRELIMINAR}\n\nCuenta las órdenes despachadas cuyo estado quedó en: ${ESTADOS_NO_COMPLETADOS.join(", ")}.`;

const COLUMNAS: ColumnaTabla<FilaDia>[] = [
  { titulo: "DÍA", valor: (f) => f.dia, alineacion: "center", anchoMinimo: 7 },
  {
    titulo: "PEDIDOS",
    valor: (f) => f.pedidos,
    alineacion: "right",
    anchoMinimo: 10,
    nota: "Solo órdenes que traen únicamente este producto. Las órdenes combo cuentan en la hoja Combos.",
  },
  {
    titulo: "UNIDADES",
    valor: (f) => f.unidades,
    alineacion: "right",
    anchoMinimo: 10,
    nota: "Todas las unidades de este producto, también las que salieron dentro de un combo.",
  },
  {
    titulo: "DEVOLUCIONES EN BODEGA",
    // Queda en blanco a propósito: la llena Diego a mano.
    valor: () => null,
    alineacion: "right",
    anchoMinimo: 16,
    nota: NOTA_DEVOLUCIONES,
  },
  {
    titulo: "NO COMPLETADOS (PRELIMINAR)",
    valor: (f) => f.noCompletados,
    alineacion: "right",
    anchoMinimo: 16,
    nota: `${NOTA_NO_COMPLETADOS}\n\nSolo órdenes que traen únicamente este producto; las de combos van en la hoja Combos.`,
  },
];

/** Las mismas 5 columnas, para la hoja Combos. */
const COLUMNAS_COMBOS: ColumnaTabla<FilaDiaCombos>[] = [
  { titulo: "DÍA", valor: (f) => f.dia, alineacion: "center", anchoMinimo: 7 },
  {
    titulo: "PEDIDOS",
    valor: (f) => f.pedidos,
    alineacion: "right",
    anchoMinimo: 10,
    nota: "Órdenes con más de un producto despachadas ese día. Cada una cuenta una sola vez, aquí y no en las hojas de producto.",
  },
  {
    titulo: "UNIDADES",
    // Las unidades de un combo ya suman en la hoja de cada producto.
    valor: () => VACIO,
    alineacion: "right",
    anchoMinimo: 10,
    nota: "Las unidades de los combos ya están en la hoja de cada producto.",
  },
  {
    titulo: "DEVOLUCIONES EN BODEGA",
    valor: () => null,
    alineacion: "right",
    anchoMinimo: 16,
    nota: NOTA_DEVOLUCIONES,
  },
  {
    titulo: "NO COMPLETADOS (PRELIMINAR)",
    valor: (f) => f.noCompletados,
    alineacion: "right",
    anchoMinimo: 16,
    nota: NOTA_NO_COMPLETADOS,
  },
];

/** Hoja de combos. No choca con un producto llamado igual: se reserva primero. */
const NOMBRE_HOJA_COMBOS = "Combos";

/**
 * Arma el historial mensual: un libro con una hoja por producto que tuvo
 * pedidos normales ese mes y, al final, la hoja Combos si hubo combos.
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

  if (historial.hojas.length === 0 && !historial.combos) {
    await escribirHojaSinMovimiento(libro, historial.etiquetaMes);
  } else {
    // Se reserva antes de nombrar las de producto: si un producto se llama
    // "Combos", es el producto el que se numera, no la hoja de combos.
    if (historial.combos) usados.add(NOMBRE_HOJA_COMBOS.toLowerCase());

    for (const hoja of historial.hojas) {
      await escribirHojaProducto(libro, hoja, historial.etiquetaMes, usados);
    }

    if (historial.combos) {
      await escribirHojaCombos(libro, historial.combos, historial.etiquetaMes);
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
 * Hoja Combos: la misma tabla diaria que las de producto, con las órdenes
 * combo, y debajo el detalle por tipo de combo del mes.
 */
async function escribirHojaCombos(
  libro: ExcelJS.Workbook,
  datos: HojaCombos,
  etiquetaMes: string,
): Promise<void> {
  const hoja = libro.addWorksheet(NOMBRE_HOJA_COMBOS);
  const columnas = COLUMNAS_COMBOS.length;

  const filaTabla = await agregarEncabezado(libro, hoja, {
    titulo: "Combos",
    subtitulo: `Historial mensual · ${etiquetaMes}`,
    columnas,
  });

  escribirTabla(hoja, {
    filaEncabezado: filaTabla,
    columnas: COLUMNAS_COMBOS,
    filas: datos.filas,
    fondoDeFila: (fila) => (fila.esJueves ? MARCA.resaltadoSuave : null),
  });

  const filaTotales = filaTabla + datos.filas.length + 1;
  escribirFilaTotales(hoja, {
    fila: filaTotales,
    columnas: COLUMNAS_COMBOS,
    valores: ["TOTAL", datos.totalPedidos, VACIO, null, datos.totalNoCompletados],
  });

  const filaNota = filaTotales + 2;
  agregarNotaAlPie(
    hoja,
    filaNota,
    `Fondo azul tenue = jueves.  ·  Cada combo cuenta un pedido aquí; sus unidades están en la hoja de cada producto.  ·  "No completados": ${AVISO_PRELIMINAR}`,
    columnas,
  );

  const filaPorDia = escribirTablaCombinada(hoja, {
    filaInicio: filaNota + 2,
    titulo: "Detalle de combos del mes",
    columnas: COLUMNAS_DETALLE,
    filas: datos.detalle,
    total: ["TOTAL", datos.totalPedidos],
  });

  escribirTablaCombinada(hoja, {
    // Una fila en blanco entre tablas, como entre la nota y el detalle.
    filaInicio: filaPorDia + 1,
    titulo: "Combos por día",
    columnas: COLUMNAS_POR_DIA,
    filas: datos.porDia,
    total: ["TOTAL", null, datos.totalPedidos],
    fondoDeFila: (fila) => (fila.esJueves ? MARCA.resaltadoSuave : null),
  });
}

/**
 * Columna de las tablas de debajo de la hoja Combos: puede ocupar varias
 * columnas de la hoja, combinadas.
 */
interface ColumnaCombinada<T> {
  titulo: string;
  /** Primera y última columna de la hoja que ocupa (1 = A). */
  desde: number;
  hasta: number;
  valor: (fila: T) => string | number;
  alineacion: "left" | "right" | "center";
}

/** El nombre del combo ocupa las primeras cuatro columnas; los pedidos, la quinta. */
const COLUMNAS_DETALLE: ColumnaCombinada<ConteoCombo>[] = [
  { titulo: "TIPO DE COMBO", desde: 1, hasta: 4, valor: (c) => c.nombre, alineacion: "left" },
  { titulo: "PEDIDOS", desde: 5, hasta: 5, valor: (c) => c.pedidos, alineacion: "right" },
];

/** DÍA cae sobre la columna DÍA de la tabla diaria; el nombre, de la B a la D. */
const COLUMNAS_POR_DIA: ColumnaCombinada<FilaComboPorDia>[] = [
  { titulo: "DÍA", desde: 1, hasta: 1, valor: (f) => f.dia, alineacion: "center" },
  { titulo: "TIPO DE COMBO", desde: 2, hasta: 4, valor: (f) => f.nombre, alineacion: "left" },
  { titulo: "PEDIDOS", desde: 5, hasta: 5, valor: (f) => f.pedidos, alineacion: "right" },
];

/**
 * Tabla con título debajo de la diaria, con el estilo de marca.
 *
 * Los nombres de combo van en columnas combinadas: con `escribirTabla`
 * caerían en una sola columna y el ajuste automático la ensancharía para toda
 * la hoja (la columna DÍA quedaría enorme).
 *
 * Devuelve la primera fila libre debajo de la fila TOTAL.
 */
function escribirTablaCombinada<T>(
  hoja: ExcelJS.Worksheet,
  {
    filaInicio,
    titulo,
    columnas,
    filas,
    total,
    fondoDeFila,
  }: {
    filaInicio: number;
    titulo: string;
    columnas: ColumnaCombinada<T>[];
    filas: T[];
    /** Un valor por columna; `null` la deja vacía. */
    total: (string | number | null)[];
    fondoDeFila?: (fila: T) => string | null;
  },
): number {
  const fuente = { name: "Calibri", size: 10 } as const;

  /** Escribe una fila: combina, pone los valores y aplica el estilo a cada celda. */
  const escribirFila = (
    fila: number,
    valores: (string | number | null)[],
    estilo: (celda: ExcelJS.Cell, columna: ColumnaCombinada<T>) => void,
  ) => {
    columnas.forEach((columna, i) => {
      if (columna.hasta > columna.desde) {
        hoja.mergeCells(fila, columna.desde, fila, columna.hasta);
      }
      hoja.getCell(fila, columna.desde).value = valores[i] ?? null;
      for (let c = columna.desde; c <= columna.hasta; c += 1) {
        estilo(hoja.getCell(fila, c), columna);
      }
    });
  };

  const filaEncabezado = agregarTitulo(hoja, filaInicio, titulo);

  // Encabezado, con el mismo estilo que el de la tabla diaria.
  escribirFila(filaEncabezado, columnas.map((c) => c.titulo), (celda, columna) => {
    celda.font = { ...fuente, bold: true, color: { argb: MARCA.crema } };
    celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: MARCA.azul } };
    celda.alignment = { horizontal: columna.alineacion, vertical: "middle" };
  });

  filas.forEach((datos, i) => {
    const fondo = fondoDeFila?.(datos) ?? null;

    escribirFila(filaEncabezado + 1 + i, columnas.map((c) => c.valor(datos)), (celda, columna) => {
      celda.font = { ...fuente, color: { argb: MARCA.texto } };
      celda.alignment = {
        horizontal: columna.alineacion,
        vertical: "middle",
        // Un nombre de combo largo baja de línea en vez de desbordarse.
        wrapText: columna.hasta > columna.desde,
      };
      celda.border = { bottom: { style: "hair", color: { argb: MARCA.borde } } };
      if (fondo) {
        celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fondo } };
      }
    });
  });

  const filaTotal = filaEncabezado + 1 + filas.length;
  escribirFila(filaTotal, total, (celda, columna) => {
    celda.font = { ...fuente, bold: true, color: { argb: MARCA.azul } };
    celda.alignment = { horizontal: columna.alineacion, vertical: "middle" };
    celda.border = { top: { style: "thin", color: { argb: MARCA.azul } } };
  });

  return filaTotal + 1;
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
