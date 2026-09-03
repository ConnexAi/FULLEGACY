/**
 * Reporte Ordenado de una carga.
 *
 * Es una herramienta operativa: Diego lo usa para reingresar el orden en Dropi,
 * imprimir las guías y despachar de forma organizada. Por eso el orden importa
 * tanto como el contenido.
 *
 * Solo entran las órdenes cuyo estado empieza por "PENDIENTE" — las que están
 * por despachar. Como consecuencia, ninguna tiene guía todavía.
 */

/** Fila plana de `v_lineas_carga`: una por producto de una orden. */
export interface LineaCarga {
  id_orden: number;
  estado: string;
  estado_normalizado: string;
  numero_guia: string | null;
  transportadora: string | null;
  ciudad_destino: string | null;
  linea: number;
  producto_id: number;
  producto_nombre: string;
  variacion_id: number | null;
  texto_variacion: string | null;
  unidades_extraidas: number | null;
  cantidad: number;
}

/**
 * NORMAL   → la orden trae un solo producto.
 * COMBO    → la orden trae más de uno; va en una sola fila, con los productos
 *            que la componen y sus cantidades en la columna PRODUCTO.
 */
export type TipoFila = "NORMAL" | "COMBO";

export interface FilaReporte {
  tipo: TipoFila;
  producto: string;
  variacion: string;
  cantidad: number;
  numeroGuia: string | null;
  idOrden: number;
  transportadora: string | null;
  ciudadDestino: string | null;
}

export interface ConteoProducto {
  producto: string;
  pedidos: number;
  unidades: number;
}

export interface ReporteOrdenado {
  filas: FilaReporte[];
  conteoPorProducto: ConteoProducto[];
  totalPedidos: number;
  totalUnidades: number;
}

/** Marcador para las celdas sin valor, como en el reporte de referencia. */
const VACIO = "—";

/** El filtro de estados del Reporte Ordenado. */
export function esEstadoDelReporte(estadoNormalizado: string): boolean {
  return estadoNormalizado.startsWith("PENDIENTE");
}

/**
 * Construye el reporte a partir de las líneas planas de una carga.
 *
 * Se filtra también acá (no solo en SQL) para que la regla viva en un único
 * lugar verificable por pruebas.
 */
export function construirReporteOrdenado(
  lineas: LineaCarga[],
): ReporteOrdenado {
  const porOrden = agruparPorOrden(
    lineas.filter((l) => esEstadoDelReporte(l.estado_normalizado)),
  );

  const filas = [...porOrden.values()]
    .map(construirFila)
    .sort(compararFilas)
    .map(({ fila }) => fila);

  return {
    filas,
    conteoPorProducto: contarPorProducto(porOrden),
    totalPedidos: porOrden.size,
    totalUnidades: [...porOrden.values()].reduce(
      (total, ls) => total + ls.reduce((n, l) => n + l.cantidad, 0),
      0,
    ),
  };
}

/* -------------------------------------------------------------------------- */

function agruparPorOrden(lineas: LineaCarga[]): Map<number, LineaCarga[]> {
  const porOrden = new Map<number, LineaCarga[]>();

  for (const linea of lineas) {
    const actual = porOrden.get(linea.id_orden);
    if (actual) actual.push(linea);
    else porOrden.set(linea.id_orden, [linea]);
  }

  // Dentro de cada orden, el orden del archivo. El combo se ancla al primero.
  for (const ls of porOrden.values()) {
    ls.sort((a, b) => a.linea - b.linea || a.producto_id - b.producto_id);
  }

  return porOrden;
}

/** Claves de ordenamiento, separadas de la fila que se muestra. */
interface FilaConOrden {
  fila: FilaReporte;
  /** Producto bajo el que se agrupa. En un combo, el primero que contiene. */
  anclaProducto: string;
  /** Las variaciones se ordenan numéricamente, no alfabéticamente. */
  anclaUnidades: number | null;
  anclaVariacion: string;
}

function construirFila(lineas: LineaCarga[]): FilaConOrden {
  const primera = lineas[0];
  const esCombo = lineas.length > 1;

  const fila: FilaReporte = {
    tipo: esCombo ? "COMBO" : "NORMAL",
    producto: esCombo
      ? `COMBO · ${lineas
          .map((l) => `${l.producto_nombre} (${l.cantidad})`)
          .join(" + ")}`
      : primera.producto_nombre,
    variacion: esCombo
      ? lineas.map((l) => l.texto_variacion ?? VACIO).join(" + ")
      : (primera.texto_variacion ?? VACIO),
    // Un combo es un pedido a preparar, no una suma de unidades: las
    // cantidades de cada producto van en la columna PRODUCTO.
    cantidad: esCombo ? 1 : primera.cantidad,
    numeroGuia: primera.numero_guia,
    idOrden: primera.id_orden,
    transportadora: primera.transportadora,
    ciudadDestino: primera.ciudad_destino,
  };

  return {
    fila,
    anclaProducto: primera.producto_nombre,
    anclaUnidades: esCombo ? null : primera.unidades_extraidas,
    anclaVariacion: esCombo ? "" : (primera.texto_variacion ?? ""),
  };
}

/**
 * Producto A→Z → variaciones agrupadas (numéricamente por unidades) →
 * cantidad ascendente. El id de orden cierra el desempate para que el
 * resultado sea estable entre ejecuciones.
 */
function compararFilas(a: FilaConOrden, b: FilaConOrden): number {
  const porProducto = a.anclaProducto.localeCompare(b.anclaProducto, "es", {
    sensitivity: "base",
  });
  if (porProducto !== 0) return porProducto;

  // Las filas sin variación van antes que las que sí tienen.
  const aTiene = a.anclaVariacion !== "";
  const bTiene = b.anclaVariacion !== "";
  if (aTiene !== bTiene) return aTiene ? 1 : -1;

  // "1 unidad" < "2 unidades" < "10 unidades", no "1, 10, 2".
  if (a.anclaUnidades !== null && b.anclaUnidades !== null) {
    if (a.anclaUnidades !== b.anclaUnidades) {
      return a.anclaUnidades - b.anclaUnidades;
    }
  } else if (a.anclaUnidades !== b.anclaUnidades) {
    // La que no se pudo interpretar va después.
    return a.anclaUnidades === null ? 1 : -1;
  }

  const porVariacion = a.anclaVariacion.localeCompare(b.anclaVariacion, "es", {
    sensitivity: "base",
  });
  if (porVariacion !== 0) return porVariacion;

  if (a.fila.cantidad !== b.fila.cantidad) {
    return a.fila.cantidad - b.fila.cantidad;
  }

  return a.fila.idOrden - b.fila.idOrden;
}

/**
 * Conteo resumido por producto.
 *
 * En un combo cada producto que lo compone se cuenta por separado, tal como
 * pide el acuerdo: para el conteo, un combo son sus partes.
 */
function contarPorProducto(porOrden: Map<number, LineaCarga[]>): ConteoProducto[] {
  const conteo = new Map<string, { pedidos: Set<number>; unidades: number }>();

  for (const lineas of porOrden.values()) {
    for (const linea of lineas) {
      let actual = conteo.get(linea.producto_nombre);
      if (!actual) {
        actual = { pedidos: new Set(), unidades: 0 };
        conteo.set(linea.producto_nombre, actual);
      }
      actual.pedidos.add(linea.id_orden);
      actual.unidades += linea.cantidad;
    }
  }

  return [...conteo.entries()]
    .map(([producto, { pedidos, unidades }]) => ({
      producto,
      pedidos: pedidos.size,
      unidades,
    }))
    .sort((a, b) => a.producto.localeCompare(b.producto, "es", { sensitivity: "base" }));
}
