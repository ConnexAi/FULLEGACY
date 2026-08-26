/**
 * Interpretación de las fechas del export de Dropi.
 *
 * Las celdas de fecha llegan de tres formas distintas según cómo Dropi haya
 * generado el archivo:
 *   - `Date`   — ExcelJS ya convirtió una celda con formato de fecha.
 *   - `number` — número de serie de Excel (la celda quedó como numérica).
 *   - `string` — texto plano, típicamente "DD/MM/YYYY HH:mm:ss".
 *
 * En los tres casos el valor representa una hora de pared colombiana, sin
 * zona horaria explícita. Se reinterpreta como America/Bogotá (UTC-5, sin
 * horario de verano) antes de guardarla como timestamptz.
 *
 * Esto importa para el historial mensual del Sprint 3: agrupar por día con la
 * zona equivocada correría los despachos de la noche al día siguiente.
 */

/** Colombia no aplica horario de verano, así que el offset es constante. */
const OFFSET_BOGOTA_MS = 5 * 60 * 60 * 1000;

/** Epoch de Excel (1899-12-30 por el bug del año bisiesto de 1900). */
const EPOCH_EXCEL_MS = Date.UTC(1899, 11, 30);
const MS_POR_DIA = 24 * 60 * 60 * 1000;

/** Convierte componentes de hora de pared bogotana al instante UTC equivalente. */
function desdeHoraBogota(
  anio: number,
  mes: number,
  dia: number,
  hora = 0,
  minuto = 0,
  segundo = 0,
): Date {
  return new Date(
    Date.UTC(anio, mes - 1, dia, hora, minuto, segundo) + OFFSET_BOGOTA_MS,
  );
}

/** "DD/MM/YYYY", opcionalmente con hora. Dropi es colombiano: día primero. */
const RE_DIA_PRIMERO =
  /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/;

/** "YYYY-MM-DD", opcionalmente con hora. */
const RE_ANIO_PRIMERO =
  /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/;

/**
 * Interpreta una celda de fecha de Dropi.
 * Devuelve `null` si la celda está vacía o no es una fecha reconocible.
 */
export function parsearFechaDropi(valor: unknown): Date | null {
  if (valor === null || valor === undefined || valor === "") return null;

  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return null;
    // ExcelJS construye el Date con los componentes de la celda en UTC.
    // Se leen tal cual y se reinterpretan como hora bogotana.
    return desdeHoraBogota(
      valor.getUTCFullYear(),
      valor.getUTCMonth() + 1,
      valor.getUTCDate(),
      valor.getUTCHours(),
      valor.getUTCMinutes(),
      valor.getUTCSeconds(),
    );
  }

  if (typeof valor === "number") {
    if (!Number.isFinite(valor) || valor <= 0) return null;
    const comoUtc = new Date(EPOCH_EXCEL_MS + Math.round(valor * MS_POR_DIA));
    if (Number.isNaN(comoUtc.getTime())) return null;
    return desdeHoraBogota(
      comoUtc.getUTCFullYear(),
      comoUtc.getUTCMonth() + 1,
      comoUtc.getUTCDate(),
      comoUtc.getUTCHours(),
      comoUtc.getUTCMinutes(),
      comoUtc.getUTCSeconds(),
    );
  }

  if (typeof valor !== "string") return null;

  const texto = valor.trim();
  if (!texto) return null;

  // "YYYY-MM-DD" primero: es inequívoco y no compite con el formato colombiano.
  const anioPrimero = RE_ANIO_PRIMERO.exec(texto);
  if (anioPrimero) {
    return construir(
      Number(anioPrimero[1]),
      Number(anioPrimero[2]),
      Number(anioPrimero[3]),
      anioPrimero[4],
      anioPrimero[5],
      anioPrimero[6],
    );
  }

  const diaPrimero = RE_DIA_PRIMERO.exec(texto);
  if (diaPrimero) {
    return construir(
      Number(diaPrimero[3]),
      Number(diaPrimero[2]),
      Number(diaPrimero[1]),
      diaPrimero[4],
      diaPrimero[5],
      diaPrimero[6],
    );
  }

  return null;
}

function construir(
  anio: number,
  mes: number,
  dia: number,
  hora?: string,
  minuto?: string,
  segundo?: string,
): Date | null {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;

  const fecha = desdeHoraBogota(
    anio,
    mes,
    dia,
    hora ? Number(hora) : 0,
    minuto ? Number(minuto) : 0,
    segundo ? Number(segundo) : 0,
  );

  if (Number.isNaN(fecha.getTime())) return null;

  // Descarta fechas imposibles que Date normalizaría en silencio (31/02).
  const rebobinado = new Date(fecha.getTime() - OFFSET_BOGOTA_MS);
  if (rebobinado.getUTCMonth() + 1 !== mes || rebobinado.getUTCDate() !== dia) {
    return null;
  }

  return fecha;
}
