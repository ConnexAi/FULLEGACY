/**
 * Historial mensual: una hoja por producto, una fila por día del mes.
 *
 * Se arma desde la base en el momento de la descarga, sin ningún paso de
 * "actualizar": si Diego sube un Excel y descarga el historial enseguida, esas
 * órdenes ya están contadas.
 */

/**
 * Estados que, aun habiendo salido a despacho, no terminaron en entrega.
 *
 * Alimenta la columna de conteo preliminar. Deliberadamente una constante y no
 * una tabla de configuración: si Diego pide sumar otro estado, es esta línea.
 * Se comparan normalizados (mayúsculas, sin espacios sobrantes).
 */
export const ESTADOS_NO_COMPLETADOS = ["DEVOLUCION"] as const;

export const AVISO_PRELIMINAR =
  "Conteo preliminar automático, verificar antes de usar como dato final.";

/** Una fila de la agregación que devuelve `historial_mensual()`. */
export interface AgregadoDia {
  producto_id: number;
  dia: number;
  pedidos: number;
  unidades: number;
  no_completados: number;
}

export interface Producto {
  id: number;
  nombre: string;
}

/** Una fila de la hoja de un producto: un día del mes. */
export interface FilaDia {
  dia: number;
  /** 0 = domingo … 4 = jueves … 6 = sábado. */
  diaSemana: number;
  esJueves: boolean;
  pedidos: number;
  unidades: number;
  /** Siempre vacía: la llena Diego a mano. */
  devoluciones: null;
  noCompletados: number;
}

export interface HojaProducto {
  producto: Producto;
  filas: FilaDia[];
  totalPedidos: number;
  totalUnidades: number;
  totalNoCompletados: number;
}

export interface HistorialMensual {
  anio: number;
  mes: number;
  /** Nombre del mes en español, para títulos. */
  etiquetaMes: string;
  hojas: HojaProducto[];
}

const JUEVES = 4;

/** Días que tiene un mes. El día 0 del mes siguiente es el último de este. */
export function diasDelMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

/**
 * Día de la semana de una fecha del calendario, sin que la zona horaria del
 * servidor lo corra: se construye en UTC y se lee en UTC.
 */
export function diaDeLaSemana(anio: number, mes: number, dia: number): number {
  return new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay();
}

export function etiquetaDeMes(anio: number, mes: number): string {
  const nombre = new Intl.DateTimeFormat("es-CO", {
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(anio, mes - 1, 1)));

  return `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} ${anio}`;
}

export function esMesValido(anio: number, mes: number): boolean {
  return (
    Number.isInteger(anio) &&
    Number.isInteger(mes) &&
    anio >= 2000 &&
    anio <= 2100 &&
    mes >= 1 &&
    mes <= 12
  );
}

/**
 * Cruza el catálogo completo de productos con la agregación del mes.
 *
 * Entran TODOS los productos, hayan tenido pedidos o no: si no tuvieron, su
 * hoja sale con todos los días en cero. Y entran todos los días del mes,
 * incluso los que aún no llegaron — así el archivo se puede descargar a mitad
 * de mes sin que falten filas.
 */
export function construirHistorialMensual(
  anio: number,
  mes: number,
  productos: Producto[],
  agregados: AgregadoDia[],
): HistorialMensual {
  const total = diasDelMes(anio, mes);

  const porProducto = new Map<number, Map<number, AgregadoDia>>();
  for (const agregado of agregados) {
    let porDia = porProducto.get(agregado.producto_id);
    if (!porDia) {
      porDia = new Map();
      porProducto.set(agregado.producto_id, porDia);
    }
    porDia.set(agregado.dia, agregado);
  }

  const hojas = [...productos]
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }))
    .map((producto) => {
      const porDia = porProducto.get(producto.id);
      const filas: FilaDia[] = [];

      for (let dia = 1; dia <= total; dia += 1) {
        const agregado = porDia?.get(dia);
        const diaSemana = diaDeLaSemana(anio, mes, dia);

        filas.push({
          dia,
          diaSemana,
          esJueves: diaSemana === JUEVES,
          pedidos: agregado?.pedidos ?? 0,
          unidades: agregado?.unidades ?? 0,
          devoluciones: null,
          noCompletados: agregado?.no_completados ?? 0,
        });
      }

      return {
        producto,
        filas,
        totalPedidos: filas.reduce((n, f) => n + f.pedidos, 0),
        totalUnidades: filas.reduce((n, f) => n + f.unidades, 0),
        totalNoCompletados: filas.reduce((n, f) => n + f.noCompletados, 0),
      };
    });

  return { anio, mes, etiquetaMes: etiquetaDeMes(anio, mes), hojas };
}

/** Un día del mes con el total de pedidos y unidades de todos los productos. */
export interface PedidosDelDia {
  dia: number;
  esJueves: boolean;
  pedidos: number;
  unidades: number;
}

export interface ResumenDelMes {
  anio: number;
  mes: number;
  dias: PedidosDelDia[];
  totalPedidos: number;
  totalUnidades: number;
  /** Último día de la serie: hoy, si el mes está en curso. */
  ultimoDia: number;
}

/**
 * Aplana la agregación por producto en una serie diaria del mes completo.
 *
 * Es lo que necesita el vistazo de la página de inicio: no interesa qué
 * producto fue, sino cuánto se despachó cada día.
 *
 * `hastaHoy` corta la serie: dibujar los días que todavía no llegaron los
 * mostraría en cero y parecería que el despacho se frenó.
 */
export function resumirPorDia(
  anio: number,
  mes: number,
  agregados: AgregadoDia[],
  hastaHoy?: number,
): ResumenDelMes {
  const porDia = new Map<number, { pedidos: number; unidades: number }>();

  for (const fila of agregados) {
    const actual = porDia.get(fila.dia) ?? { pedidos: 0, unidades: 0 };
    // Una orden con dos productos suma en los dos: acá se mide volumen de
    // despacho, no órdenes únicas.
    actual.pedidos += fila.pedidos;
    actual.unidades += fila.unidades;
    porDia.set(fila.dia, actual);
  }

  const total = diasDelMes(anio, mes);
  const ultimoDia = Math.min(Math.max(hastaHoy ?? total, 0), total);

  const dias: PedidosDelDia[] = [];
  for (let dia = 1; dia <= ultimoDia; dia += 1) {
    const valores = porDia.get(dia);
    dias.push({
      dia,
      esJueves: diaDeLaSemana(anio, mes, dia) === 4,
      pedidos: valores?.pedidos ?? 0,
      unidades: valores?.unidades ?? 0,
    });
  }

  return {
    anio,
    mes,
    dias,
    totalPedidos: dias.reduce((n, d) => n + d.pedidos, 0),
    totalUnidades: dias.reduce((n, d) => n + d.unidades, 0),
    ultimoDia,
  };
}
