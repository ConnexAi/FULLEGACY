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

/**
 * Un (producto, día) con movimiento: la unidad con la que trabaja toda la
 * lógica de negocio de este módulo (armar hojas, totales, Excel).
 *
 * No es la forma en la que viaja desde la base — ver `FilaHistorialMensual` y
 * `aplanarHistorialMensual` — sino la que consumen `construirHistorialMensual`
 * y sus pruebas. Mantenerla separada del contrato de red es lo que permite que
 * ese contrato cambie (como pasó acá) sin tocar la lógica de negocio.
 */
export interface AgregadoDia {
  producto_id: number;
  dia: number;
  pedidos: number;
  unidades: number;
  no_completados: number;
}

/** Un día dentro de `FilaHistorialMensual.dias`, tal como lo arma el jsonb_agg de SQL. */
export interface DiaAgregado {
  dia: number;
  pedidos: number;
  unidades: number;
  no_completados: number;
}

/**
 * Una fila TAL COMO LA DEVUELVE `historial_mensual()`: una por producto, con
 * los días agregados adentro.
 *
 * Es la forma que evita el problema de fondo — con esto, el número de filas
 * que cruza la red depende solo de cuántos productos tuvieron movimiento ese
 * mes, nunca de los días. Un catálogo de 40+ productos, todos vendiendo los 31
 * días del mes, sigue siendo 40 filas, no 1240.
 */
export interface FilaHistorialMensual {
  producto_id: number;
  dias: DiaAgregado[];
}

/**
 * Aplana la respuesta de `historial_mensual()` a la forma plana con la que
 * trabaja el resto de este módulo.
 *
 * Es el único lugar que conoce el contrato de red de la función: si ese
 * contrato vuelve a cambiar, es acá donde se ajusta, sin tocar
 * `construirHistorialMensual` ni sus pruebas.
 */
export function aplanarHistorialMensual(
  filas: FilaHistorialMensual[],
): AgregadoDia[] {
  return filas.flatMap((fila) =>
    fila.dias.map((dia) => ({ producto_id: fila.producto_id, ...dia })),
  );
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
  /** Solo los productos con al menos un pedido ese mes. */
  hojas: HojaProducto[];
  /** Tamaño del catálogo completo, para mostrar "N de M productos" en la pantalla. */
  totalProductosEnCatalogo: number;
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
 * Cruza el catálogo con la agregación del mes.
 *
 * Solo generan hoja los productos que tuvieron AL MENOS UN pedido con fecha de
 * guía generada ese mes. Con un catálogo que va a crecer a 30-40+ productos y
 * que va a tener bajas, una hoja en cero por cada producto sin movimiento (o
 * descontinuado) es ruido que Diego no quiere ver — decisión explícita del
 * Sprint 3 revertida acá.
 *
 * Cada fila que devuelve `historial_mensual()` ya representa al menos un
 * pedido de ese producto ese día (agrupa con `count`, nunca emite un cero), así
 * que "el producto aparece en `agregados`" es exactamente "tuvo pedidos" — no
 * hace falta un umbral aparte.
 *
 * Los días del mes sí se completan todos dentro de cada hoja que sí se genera,
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

  const hojas = productos
    .filter((producto) => porProducto.has(producto.id))
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

  return {
    anio,
    mes,
    etiquetaMes: etiquetaDeMes(anio, mes),
    hojas,
    totalProductosEnCatalogo: productos.length,
  };
}

/** Una fila de `totales_diarios()`: el día ya agregado, sin producto. */
export interface TotalDia {
  dia: number;
  pedidos: number;
  unidades: number;
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
 * Completa la serie diaria del mes a partir de los totales por día.
 *
 * La entrada viene de `totales_diarios()`, que ya cuenta cada orden una sola
 * vez aunque traiga varios productos. No se suman filas por producto acá:
 * hacerlo era lo que inflaba los totales con cada combo.
 *
 * `hastaHoy` corta la serie: dibujar los días que todavía no llegaron los
 * mostraría en cero y parecería que el despacho se frenó.
 */
export function resumirPorDia(
  anio: number,
  mes: number,
  totales: TotalDia[],
  hastaHoy?: number,
): ResumenDelMes {
  const porDia = new Map<number, { pedidos: number; unidades: number }>();
  for (const fila of totales) {
    porDia.set(fila.dia, { pedidos: fila.pedidos, unidades: fila.unidades });
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
