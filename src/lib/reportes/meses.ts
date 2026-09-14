/** Utilidades de mes compartidas por las pantallas de historial y dashboard. */

/** El mes en curso según el calendario colombiano, no el del servidor. */
export function mesActualEnBogota(): { anio: number; mes: number } {
  const partes = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    timeZone: "America/Bogota",
  }).format(new Date());

  const [anio, mes] = partes.split("-").map(Number);
  return { anio, mes };
}

/** El día del mes de hoy, en el calendario colombiano. */
export function diaDeHoyEnBogota(): number {
  return Number(
    new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      timeZone: "America/Bogota",
    }).format(new Date()),
  );
}

export interface OpcionMes {
  anio: number;
  mes: number;
  /** "2026-09", el valor que viaja por la URL. */
  valor: string;
  etiqueta: string;
}

/** Los últimos `cantidad` meses, del más reciente al más viejo. */
export function ultimosMeses(cantidad: number): OpcionMes[] {
  const { anio, mes } = mesActualEnBogota();
  const opciones: OpcionMes[] = [];

  for (let i = 0; i < cantidad; i += 1) {
    const fecha = new Date(Date.UTC(anio, mes - 1 - i, 1));
    const a = fecha.getUTCFullYear();
    const m = fecha.getUTCMonth() + 1;
    const nombre = new Intl.DateTimeFormat("es-CO", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(fecha);

    opciones.push({
      anio: a,
      mes: m,
      valor: `${a}-${String(m).padStart(2, "0")}`,
      etiqueta: `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)}`,
    });
  }

  return opciones;
}

/** Interpreta "2026-09" de la URL. Devuelve `null` si no es válido. */
export function leerValorMes(valor: string | undefined): { anio: number; mes: number } | null {
  if (!valor) return null;

  const coincidencia = /^(\d{4})-(\d{2})$/.exec(valor);
  if (!coincidencia) return null;

  const anio = Number(coincidencia[1]);
  const mes = Number(coincidencia[2]);
  if (mes < 1 || mes > 12) return null;

  return { anio, mes };
}
