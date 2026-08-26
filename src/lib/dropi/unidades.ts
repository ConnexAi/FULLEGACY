/**
 * Extracción del número de unidades desde el texto de la variación.
 *
 * Sirve para que los reportes ordenen "1 unidad, 2 unidades, 3 unidades"
 * numéricamente y no alfabéticamente ("1, 10, 2, 3").
 *
 * No se usa para identificar variaciones: eso ya lo resuelve el VARIACION_ID
 * de Dropi. Es solo un dato de presentación, por eso es nullable.
 */

/** "1 unidad", "2 unidades", "10 UNIDADES", "x3 unidades". */
const RE_UNIDADES = /(\d+(?:[.,]\d+)?)\s*unidad(?:es)?\b/;

/**
 * Devuelve el número de unidades que menciona el texto, o `null` si el texto
 * no sigue ese patrón (ej. la variación "p01" de una pulsera).
 */
export function extraerUnidades(texto: string | null | undefined): number | null {
  if (!texto) return null;

  const normalizado = texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  const coincidencia = RE_UNIDADES.exec(normalizado);
  if (!coincidencia) return null;

  const numero = Number(coincidencia[1].replace(",", "."));
  if (!Number.isFinite(numero) || numero <= 0) return null;

  return numero;
}
