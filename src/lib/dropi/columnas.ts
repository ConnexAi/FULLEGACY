/**
 * Mapeo de las columnas del export de Dropi.
 *
 * El archivo trae 54 columnas; aquí solo se declaran las que usa la ingesta.
 * El resto se ignora.
 */

/** Columnas que la ingesta lee. */
export type ColumnaDropi =
  | "ID"
  | "ESTATUS"
  | "FECHA"
  | "FECHA_GUIA_GENERADA"
  | "NUMERO_GUIA"
  | "PRODUCTO_ID"
  | "SKU"
  | "VARIACION_ID"
  | "PRODUCTO"
  | "VARIACION"
  | "CANTIDAD";

/**
 * Sin estas cuatro no se puede construir ni una sola fila útil, así que el
 * archivo se rechaza completo antes de procesar nada.
 */
export const COLUMNAS_CRITICAS: ColumnaDropi[] = [
  "ID",
  "ESTATUS",
  "PRODUCTO_ID",
  "VARIACION_ID",
];

/**
 * Encabezados aceptados por columna, ya normalizados (mayúsculas, sin tildes,
 * espacios colapsados). Se aceptan variantes porque Dropi ha cambiado la
 * tilde de "NÚMERO GUIA" y el separador de algunos encabezados entre exports.
 */
const ENCABEZADOS: Record<ColumnaDropi, string[]> = {
  ID: ["ID", "ID ORDEN", "ORDEN ID"],
  ESTATUS: ["ESTATUS", "ESTADO"],
  FECHA: ["FECHA", "FECHA ORDEN", "FECHA DE ORDEN"],
  FECHA_GUIA_GENERADA: [
    "FECHA GUIA GENERADA",
    "FECHA DE GUIA GENERADA",
    "FECHA GUIA",
  ],
  NUMERO_GUIA: ["NUMERO GUIA", "NUMERO DE GUIA", "N GUIA", "GUIA"],
  PRODUCTO_ID: ["PRODUCTO ID", "ID PRODUCTO"],
  SKU: ["SKU"],
  VARIACION_ID: ["VARIACION ID", "ID VARIACION"],
  PRODUCTO: ["PRODUCTO", "NOMBRE PRODUCTO"],
  VARIACION: ["VARIACION"],
  CANTIDAD: ["CANTIDAD", "CANT"],
};

/** Nombre legible de cada columna, para los mensajes de error. */
export const ETIQUETAS: Record<ColumnaDropi, string> = {
  ID: "ID",
  ESTATUS: "ESTATUS",
  FECHA: "FECHA",
  FECHA_GUIA_GENERADA: "FECHA GUIA GENERADA",
  NUMERO_GUIA: "NÚMERO GUIA",
  PRODUCTO_ID: "PRODUCTO ID",
  SKU: "SKU",
  VARIACION_ID: "VARIACION ID",
  PRODUCTO: "PRODUCTO",
  VARIACION: "VARIACION",
  CANTIDAD: "CANTIDAD",
};

/**
 * Normaliza un encabezado para poder compararlo: mayúsculas, sin tildes,
 * sin signos de puntuación y con los espacios colapsados.
 *
 * "Número Guía" y "NUMERO_GUIA" terminan ambos en "NUMERO GUIA".
 */
export function normalizarEncabezado(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // tildes
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

/** Índice (base 1, como ExcelJS) de cada columna encontrada en la fila de encabezados. */
export type MapaColumnas = Partial<Record<ColumnaDropi, number>>;

/**
 * Ubica las columnas conocidas dentro de la fila de encabezados.
 * Devuelve también las críticas que falten, para poder abortar temprano.
 */
export function mapearColumnas(encabezados: string[]): {
  mapa: MapaColumnas;
  criticasFaltantes: ColumnaDropi[];
} {
  const mapa: MapaColumnas = {};

  encabezados.forEach((crudo, indice) => {
    const normalizado = normalizarEncabezado(crudo ?? "");
    if (!normalizado) return;

    for (const [columna, alias] of Object.entries(ENCABEZADOS) as [
      ColumnaDropi,
      string[],
    ][]) {
      // La primera aparición gana: si el export repitiera un encabezado,
      // nos quedamos con la columna de más a la izquierda.
      if (mapa[columna] === undefined && alias.includes(normalizado)) {
        mapa[columna] = indice + 1; // ExcelJS indexa las celdas desde 1
        return;
      }
    }
  });

  const criticasFaltantes = COLUMNAS_CRITICAS.filter(
    (columna) => mapa[columna] === undefined,
  );

  return { mapa, criticasFaltantes };
}
