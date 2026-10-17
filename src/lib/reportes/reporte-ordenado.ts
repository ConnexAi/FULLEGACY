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

/**
 * PRODUCTO → fila de un producto, contando solo sus órdenes normales.
 * COMBO    → fila de un tipo de combo (mismos productos, mismas cantidades).
 */
export type TipoConteo = "PRODUCTO" | "COMBO";

export interface ConteoProducto {
  tipo: TipoConteo;
  producto: string;
  pedidos: number;
  /**
   * `null` en las filas de combo: las unidades de un combo ya están contadas
   * en las filas de los productos que lo componen, así que repetirlas acá
   * sería contarlas dos veces. Se muestran como «—».
   */
  unidades: number | null;
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
  const combo = esCombo(lineas);

  const fila: FilaReporte = {
    tipo: combo ? "COMBO" : "NORMAL",
    producto: combo ? nombreDeCombo(lineas) : primera.producto_nombre,
    variacion: combo
      ? lineas.map((l) => l.texto_variacion ?? VACIO).join(" + ")
      : (primera.texto_variacion ?? VACIO),
    // Un combo es un pedido a preparar, no una suma de unidades: las
    // cantidades de cada producto van en la columna PRODUCTO.
    cantidad: combo ? 1 : primera.cantidad,
    numeroGuia: primera.numero_guia,
    idOrden: primera.id_orden,
    transportadora: primera.transportadora,
    ciudadDestino: primera.ciudad_destino,
  };

  return {
    fila,
    anclaProducto: primera.producto_nombre,
    anclaUnidades: combo ? null : primera.unidades_extraidas,
    anclaVariacion: combo ? "" : (primera.texto_variacion ?? ""),
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
 * Lo mínimo que hace falta de cada línea para tratar una orden como combo.
 *
 * Es un subconjunto de `LineaCarga` a propósito: así el historial mensual,
 * que no lee `v_lineas_carga`, usa exactamente estas mismas reglas.
 */
export type LineaDeCombo = Pick<LineaCarga, "id_orden" | "producto_nombre" | "cantidad">;

/**
 * Una orden es COMBO cuando trae más de una línea (más de un producto).
 *
 * Es la definición de TIPO = COMBO del reporte, y la que reutiliza el
 * historial mensual: si cambia, cambia en los dos.
 */
export function esCombo(lineas: readonly unknown[]): boolean {
  return lineas.length > 1;
}

/** El nombre de un combo, tal como se muestra en la tabla principal. */
export function nombreDeCombo(lineas: LineaDeCombo[]): string {
  return `COMBO · ${lineas
    .map((l) => `${l.producto_nombre} (${l.cantidad})`)
    .join(" + ")}`;
}

/**
 * Identidad de un tipo de combo: los mismos productos con las mismas
 * cantidades.
 *
 * Se canonicaliza ordenando por nombre, así que no depende de en qué orden
 * vinieran las líneas en el archivo. Lleva la cantidad adentro a propósito:
 * "AW chocolate (2) + AW 839 azul (1)" es un tipo distinto de
 * "AW chocolate (1) + AW 839 azul (1)", porque se alista distinto.
 */
function firmaDeCombo(lineas: LineaDeCombo[]): string {
  return lineas
    .map((l) => `${l.producto_nombre}\u0000${l.cantidad}`)
    .sort()
    .join("\u0001");
}

/**
 * Conteo resumido del Reporte Ordenado.
 *
 * La regla anterior contaba un pedido en la fila de cada producto que componía
 * el combo, así que la columna PEDIDOS sumaba más que el Total: la orden
 * 92862480 de la carga del 13/10 (AW chocolate + AW 839 azul) aparecía dos
 * veces, y 78 órdenes se veían como 79 pedidos.
 *
 * Ahora cada orden se cuenta en una sola fila:
 *
 *   - Fila de producto: PEDIDOS son solo sus órdenes normales. UNIDADES suma
 *     todas las unidades del producto, también las que llegan dentro de un
 *     combo — esas unidades hay que alistarlas igual.
 *   - Fila de combo: una por tipo de combo, con cuántas órdenes de ese tipo
 *     hay. UNIDADES va vacío para no contar dos veces lo que ya está arriba.
 *   - Un producto que solo aparece dentro de combos no tiene fila propia: sus
 *     unidades se leen en el nombre de la fila del combo.
 *
 * Consecuencia esperada: la columna PEDIDOS suma exactamente el Total, y la
 * columna UNIDADES puede sumar MENOS que el total cuando hay productos que
 * solo vienen en combos. Esa diferencia es correcta, no un descuadre.
 */
function contarPorProducto(porOrden: Map<number, LineaCarga[]>): ConteoProducto[] {
  const productos = new Map<string, { pedidos: number; unidades: number }>();

  for (const lineas of porOrden.values()) {
    const combo = esCombo(lineas);

    for (const linea of lineas) {
      let actual = productos.get(linea.producto_nombre);
      if (!actual) {
        actual = { pedidos: 0, unidades: 0 };
        productos.set(linea.producto_nombre, actual);
      }

      actual.unidades += linea.cantidad;
      // Una orden normal tiene una sola línea, así que esto cuenta la orden
      // una vez y nada más.
      if (!combo) actual.pedidos += 1;
    }
  }

  const filasProducto: ConteoProducto[] = [...productos.entries()]
    // Sin órdenes normales no hay fila: el producto solo existe en combos.
    .filter(([, { pedidos }]) => pedidos > 0)
    .map(([producto, { pedidos, unidades }]) => ({
      tipo: "PRODUCTO" as const,
      producto,
      pedidos,
      unidades,
    }))
    .sort(porNombre);

  const filasCombo: ConteoProducto[] = contarCombos(porOrden.values()).map(
    ({ nombre, pedidos }) => ({
      tipo: "COMBO" as const,
      producto: nombre,
      pedidos,
      unidades: null,
    }),
  );

  // Los combos van después de los productos y antes del Total.
  return [...filasProducto, ...filasCombo];
}

/** Un tipo de combo y cuántas órdenes de ese tipo hubo. */
export interface ConteoCombo {
  nombre: string;
  pedidos: number;
}

/**
 * Agrupa las órdenes combo por tipo (ver `firmaDeCombo`) y cuenta cuántas
 * hay de cada uno, ordenadas por nombre. Las órdenes normales se ignoran.
 *
 * La usan el conteo del Reporte Ordenado y la hoja Combos del historial
 * mensual, para que un mismo tipo de combo se llame y se agrupe igual en los
 * dos archivos.
 */
export function contarCombos(ordenes: Iterable<LineaDeCombo[]>): ConteoCombo[] {
  return [...tiposDeCombo(ordenes).values()]
    .map(({ nombre, pedidos }) => ({ nombre, pedidos }))
    .sort(porNombreDeCombo);
}

/**
 * Como `contarCombos`, pero separado por una clave (por ejemplo, el día).
 *
 * El nombre de cada tipo es el que le da `contarCombos` sobre TODAS las
 * órdenes recibidas, no solo las de esa clave: así un tipo se llama igual en
 * todas sus claves y en el conteo general, aunque sus órdenes traigan las
 * líneas en otro orden.
 */
export function contarCombosPorClave<K>(
  ordenes: Iterable<[K, LineaDeCombo[]]>,
): Map<K, ConteoCombo[]> {
  const lista = [...ordenes];
  const tipos = tiposDeCombo(lista.map(([, lineas]) => lineas));

  const porClave = new Map<K, Map<string, number>>();
  for (const [clave, lineas] of lista) {
    if (!esCombo(lineas)) continue;

    const firma = firmaDeCombo(lineas);
    const deLaClave = porClave.get(clave) ?? new Map<string, number>();
    deLaClave.set(firma, (deLaClave.get(firma) ?? 0) + 1);
    porClave.set(clave, deLaClave);
  }

  return new Map(
    [...porClave].map(([clave, deLaClave]) => [
      clave,
      [...deLaClave]
        .map(([firma, pedidos]) => ({ nombre: tipos.get(firma)!.nombre, pedidos }))
        .sort(porNombreDeCombo),
    ]),
  );
}

/** Tipos de combo por firma, con su nombre y cuántas órdenes tuvo cada uno. */
function tiposDeCombo(
  ordenes: Iterable<LineaDeCombo[]>,
): Map<string, { nombre: string; idAncla: number; pedidos: number }> {
  /** Por firma, para que el tipo no dependa del orden de las líneas. */
  const combos = new Map<string, { nombre: string; idAncla: number; pedidos: number }>();

  for (const lineas of ordenes) {
    if (!esCombo(lineas)) continue;

    const firma = firmaDeCombo(lineas);
    const actual = combos.get(firma);

    if (!actual) {
      combos.set(firma, {
        nombre: nombreDeCombo(lineas),
        idAncla: lineas[0].id_orden,
        pedidos: 1,
      });
    } else {
      actual.pedidos += 1;
      // El nombre se toma de la orden más antigua del tipo, no de la
      // primera que toque iterar: así el resultado no depende del orden en
      // que lleguen las filas de la consulta.
      if (lineas[0].id_orden < actual.idAncla) {
        actual.nombre = nombreDeCombo(lineas);
        actual.idAncla = lineas[0].id_orden;
      }
    }
  }

  return combos;
}

function porNombreDeCombo(a: ConteoCombo, b: ConteoCombo): number {
  return a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" });
}

function porNombre(a: ConteoProducto, b: ConteoProducto): number {
  return a.producto.localeCompare(b.producto, "es", { sensitivity: "base" });
}
