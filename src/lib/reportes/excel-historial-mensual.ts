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
  type FilaDia,
  type FilaDiaCombos,
  type HistorialMensual,
  type HojaCombos,
  type HojaProducto,
} from "@/lib/reportes/historial-mensual";

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

  escribirDetalleCombos(hoja, filaNota + 2, datos);
}

/**
 * Tabla "Detalle de combos del mes", debajo de la diaria.
 *
 * El nombre del combo ocupa las primeras cuatro columnas combinadas y los
 * pedidos van en la quinta: con `escribirTabla` el nombre caería en la
 * columna DÍA y el ajuste automático la ensancharía para toda la hoja.
 */
function escribirDetalleCombos(
  hoja: ExcelJS.Worksheet,
  filaInicio: number,
  datos: HojaCombos,
): void {
  const ultima = COLUMNAS_COMBOS.length;
  const fuente = { name: "Calibri", size: 10 } as const;

  const filaEncabezado = agregarTitulo(hoja, filaInicio, "Detalle de combos del mes");

  const celda = (fila: number, columna: number) => hoja.getCell(fila, columna);
  const combinar = (fila: number) => hoja.mergeCells(fila, 1, fila, ultima - 1);

  // Encabezado, con el mismo estilo que el de la tabla diaria.
  combinar(filaEncabezado);
  celda(filaEncabezado, 1).value = "TIPO DE COMBO";
  celda(filaEncabezado, ultima).value = "PEDIDOS";
  for (let c = 1; c <= ultima; c += 1) {
    const cabecera = celda(filaEncabezado, c);
    cabecera.font = { ...fuente, bold: true, color: { argb: MARCA.crema } };
    cabecera.fill = { type: "pattern", pattern: "solid", fgColor: { argb: MARCA.azul } };
    cabecera.alignment = { horizontal: c === ultima ? "right" : "left", vertical: "middle" };
  }

  datos.detalle.forEach((combo, i) => {
    const fila = filaEncabezado + 1 + i;
    combinar(fila);
    celda(fila, 1).value = combo.nombre;
    celda(fila, ultima).value = combo.pedidos;
    for (let c = 1; c <= ultima; c += 1) {
      const cuerpo = celda(fila, c);
      cuerpo.font = { ...fuente, color: { argb: MARCA.texto } };
      cuerpo.alignment = {
        horizontal: c === ultima ? "right" : "left",
        vertical: "middle",
        wrapText: c !== ultima,
      };
      cuerpo.border = { bottom: { style: "hair", color: { argb: MARCA.borde } } };
    }
  });

  const filaTotal = filaEncabezado + 1 + datos.detalle.length;
  combinar(filaTotal);
  celda(filaTotal, 1).value = "TOTAL";
  celda(filaTotal, ultima).value = datos.totalPedidos;
  for (let c = 1; c <= ultima; c += 1) {
    const total = celda(filaTotal, c);
    total.font = { ...fuente, bold: true, color: { argb: MARCA.azul } };
    total.alignment = { horizontal: c === ultima ? "right" : "left", vertical: "middle" };
    total.border = { top: { style: "thin", color: { argb: MARCA.azul } } };
  }
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
