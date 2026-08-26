import ExcelJS from "exceljs";

import {
  COLUMNAS_CRITICAS,
  ETIQUETAS,
  mapearColumnas,
  type ColumnaDropi,
  type MapaColumnas,
} from "@/lib/dropi/columnas";
import { parsearFechaDropi } from "@/lib/dropi/fechas";
import {
  ErrorArchivoDropi,
  type FilaConError,
  type FilaDropi,
  type ResultadoParseo,
} from "@/lib/dropi/tipos";

/**
 * Lee un .xlsx exportado de Dropi y devuelve las filas tipadas.
 *
 * Dos niveles de fallo, deliberadamente distintos:
 *   - Falta una columna crítica, o el archivo no es un xlsx legible
 *     → `ErrorArchivoDropi`: no se procesa nada del archivo.
 *   - Una fila suelta trae datos inconsistentes
 *     → se registra en `errores` y se sigue con las demás.
 */
export async function parsearExcelDropi(
  buffer: ArrayBuffer,
): Promise<ResultadoParseo> {
  const libro = new ExcelJS.Workbook();

  try {
    await libro.xlsx.load(buffer);
  } catch {
    throw new ErrorArchivoDropi(
      "No se pudo abrir el archivo. Verifica que sea un .xlsx exportado de Dropi y que no esté dañado.",
    );
  }

  const hoja = libro.worksheets[0];
  if (!hoja || hoja.rowCount === 0) {
    throw new ErrorArchivoDropi("El archivo no tiene ninguna hoja con datos.");
  }

  const filaEncabezados = hoja.getRow(1);
  const encabezados: string[] = [];
  filaEncabezados.eachCell({ includeEmpty: true }, (celda, numero) => {
    encabezados[numero - 1] = textoDeCelda(celda.value) ?? "";
  });

  const { mapa, criticasFaltantes } = mapearColumnas(encabezados);

  if (criticasFaltantes.length > 0) {
    const faltantes = criticasFaltantes.map((c) => ETIQUETAS[c]).join(", ");
    const encontradas = COLUMNAS_CRITICAS.filter(
      (c) => !criticasFaltantes.includes(c),
    )
      .map((c) => ETIQUETAS[c])
      .join(", ");

    throw new ErrorArchivoDropi(
      `El archivo no parece un export de Dropi: faltan columnas obligatorias (${faltantes}).` +
        (encontradas ? ` Sí se encontraron: ${encontradas}.` : "") +
        " No se procesó ninguna fila.",
    );
  }

  const filas: FilaDropi[] = [];
  const errores: FilaConError[] = [];
  let filasLeidas = 0;

  for (let numero = 2; numero <= hoja.rowCount; numero += 1) {
    const fila = hoja.getRow(numero);
    if (estaVacia(fila, mapa)) continue;

    filasLeidas += 1;

    try {
      filas.push(construirFila(numero, fila, mapa));
    } catch (error) {
      errores.push({
        fila: numero,
        motivo:
          error instanceof Error ? error.message : "Fila con datos inválidos.",
        // Si el ID sí se pudo leer, la fila se puede atribuir a una orden y
        // avisar que esa orden quedó incompleta.
        idOrden: leerEnteroOpcional(fila, mapa, "ID"),
      });
    }
  }

  if (filasLeidas === 0) {
    throw new ErrorArchivoDropi(
      "El archivo tiene los encabezados correctos pero ninguna fila de datos.",
    );
  }

  return { filas, errores, filasLeidas };
}

/* -------------------------------------------------------------------------- */

function construirFila(
  numero: number,
  fila: ExcelJS.Row,
  mapa: MapaColumnas,
): FilaDropi {
  const idOrden = leerEntero(fila, mapa, "ID");
  const productoId = leerEntero(fila, mapa, "PRODUCTO_ID");
  const variacionId = leerEntero(fila, mapa, "VARIACION_ID");

  const estado = leerTexto(fila, mapa, "ESTATUS");
  if (!estado) {
    throw new Error(`${ETIQUETAS.ESTATUS} está vacío.`);
  }

  const fechaOrden = parsearFechaDropi(leerCrudo(fila, mapa, "FECHA"));
  if (!fechaOrden) {
    throw new Error(
      `${ETIQUETAS.FECHA} vacía o con un formato que no se pudo interpretar.`,
    );
  }

  const cantidad = leerCantidad(fila, mapa);

  return {
    fila: numero,
    idOrden,
    estado,
    fechaOrden,
    fechaGuiaGenerada: parsearFechaDropi(
      leerCrudo(fila, mapa, "FECHA_GUIA_GENERADA"),
    ),
    numeroGuia: leerTexto(fila, mapa, "NUMERO_GUIA"),
    productoId,
    // Dropi siempre manda el nombre; el respaldo evita perder la orden entera
    // por un campo que solo se usa para mostrar.
    productoNombre: leerTexto(fila, mapa, "PRODUCTO") ?? `Producto ${productoId}`,
    sku: leerTexto(fila, mapa, "SKU"),
    variacionId,
    textoVariacion: leerTexto(fila, mapa, "VARIACION"),
    cantidad,
  };
}

function leerCantidad(fila: ExcelJS.Row, mapa: MapaColumnas): number {
  const crudo = leerCrudo(fila, mapa, "CANTIDAD");

  if (crudo === null || crudo === undefined || crudo === "") {
    throw new Error(`${ETIQUETAS.CANTIDAD} está vacía.`);
  }

  const numero =
    typeof crudo === "number" ? crudo : Number(String(crudo).trim().replace(",", "."));

  if (!Number.isFinite(numero) || !Number.isInteger(numero) || numero <= 0) {
    throw new Error(
      `${ETIQUETAS.CANTIDAD} debe ser un entero positivo (se leyó "${textoDeCelda(crudo) ?? ""}").`,
    );
  }

  return numero;
}

/** Igual que `leerEntero` pero devuelve `null` en vez de lanzar. */
function leerEnteroOpcional(
  fila: ExcelJS.Row,
  mapa: MapaColumnas,
  columna: ColumnaDropi,
): number | null {
  try {
    return leerEntero(fila, mapa, columna);
  } catch {
    return null;
  }
}

function leerEntero(
  fila: ExcelJS.Row,
  mapa: MapaColumnas,
  columna: ColumnaDropi,
): number {
  const crudo = leerCrudo(fila, mapa, columna);

  if (crudo === null || crudo === undefined || crudo === "") {
    throw new Error(`${ETIQUETAS[columna]} está vacío.`);
  }

  const texto = textoDeCelda(crudo)?.trim() ?? "";
  // Dropi manda estos ids como números; algunos exports los traen como texto.
  const numero = Number(texto);

  if (!Number.isFinite(numero) || !Number.isInteger(numero) || numero <= 0) {
    throw new Error(
      `${ETIQUETAS[columna]} no es un identificador numérico válido (se leyó "${texto}").`,
    );
  }

  if (!Number.isSafeInteger(numero)) {
    throw new Error(`${ETIQUETAS[columna]} excede el rango numérico soportado.`);
  }

  return numero;
}

function leerTexto(
  fila: ExcelJS.Row,
  mapa: MapaColumnas,
  columna: ColumnaDropi,
): string | null {
  const texto = textoDeCelda(leerCrudo(fila, mapa, columna))?.trim();
  return texto ? texto : null;
}

function leerCrudo(
  fila: ExcelJS.Row,
  mapa: MapaColumnas,
  columna: ColumnaDropi,
): ExcelJS.CellValue {
  const indice = mapa[columna];
  if (indice === undefined) return null;
  return fila.getCell(indice).value;
}

/**
 * Aplana el valor de una celda a texto.
 *
 * ExcelJS devuelve objetos para fórmulas, hipervínculos y texto enriquecido;
 * el export de Dropi trae hipervínculos en algunas columnas.
 */
function textoDeCelda(valor: ExcelJS.CellValue): string | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === "string") return valor;
  if (typeof valor === "number" || typeof valor === "boolean") {
    return String(valor);
  }
  if (valor instanceof Date) return valor.toISOString();

  if (typeof valor === "object") {
    const objeto = valor as unknown as Record<string, unknown>;

    if ("richText" in objeto && Array.isArray(objeto.richText)) {
      return objeto.richText
        .map((parte) => (parte as { text?: string }).text ?? "")
        .join("");
    }
    if ("text" in objeto && typeof objeto.text === "string") return objeto.text;
    if ("result" in objeto) return textoDeCelda(objeto.result as ExcelJS.CellValue);
    if ("hyperlink" in objeto && typeof objeto.hyperlink === "string") {
      return objeto.hyperlink;
    }
  }

  return null;
}

/** Una fila cuenta como vacía si ninguna columna conocida trae valor. */
function estaVacia(fila: ExcelJS.Row, mapa: MapaColumnas): boolean {
  return Object.values(mapa).every((indice) => {
    const valor = fila.getCell(indice).value;
    return valor === null || valor === undefined || valor === "";
  });
}
