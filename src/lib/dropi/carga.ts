import { extraerUnidades } from "@/lib/dropi/unidades";
import type { CargaParaGuardar, FilaDropi } from "@/lib/dropi/tipos";

/**
 * Agrupa las filas ya validadas en la estructura que espera `procesar_carga`.
 *
 * Dos cosas pasan acá:
 *   - El combo: todas las filas que comparten el mismo `ID` de orden se
 *     convierten en varias líneas de una misma orden.
 *   - El ruteo del SKU: si la fila trae variación, el SKU identifica a la
 *     variante; si no, es el SKU del producto.
 */
export function agruparCarga(
  filas: FilaDropi[],
  archivo: CargaParaGuardar["archivo"],
): CargaParaGuardar {
  const productos = new Map<number, CargaParaGuardar["productos"][number]>();
  const variaciones = new Map<number, CargaParaGuardar["variaciones"][number]>();
  const ordenes = new Map<number, CargaParaGuardar["ordenes"][number]>();

  for (const fila of filas) {
    // --- catálogo: producto ---------------------------------------------
    const productoExistente = productos.get(fila.productoId);

    productos.set(fila.productoId, {
      id: fila.productoId,
      // Gana la última aparición: si el nombre cambió a mitad del export, se
      // queda el más reciente.
      nombre: fila.productoNombre,
      // El SKU solo es del producto cuando la fila no trae variación. Si el
      // producto ya traía uno, no se pisa con null.
      sku: fila.variacionId === null
        ? fila.sku
        : (productoExistente?.sku ?? null),
    });

    // --- catálogo: variación (solo si el producto las maneja) -----------
    if (fila.variacionId !== null) {
      variaciones.set(fila.variacionId, {
        id: fila.variacionId,
        producto_id: fila.productoId,
        sku: fila.sku,
        texto_variacion: fila.textoVariacion,
        unidades_extraidas: extraerUnidades(fila.textoVariacion),
      });
    }

    // --- orden ----------------------------------------------------------
    let orden = ordenes.get(fila.idOrden);

    if (!orden) {
      orden = {
        id_orden: fila.idOrden,
        estado: fila.estado,
        fecha_orden: fila.fechaOrden.toISOString(),
        fecha_guia_generada: fila.fechaGuiaGenerada?.toISOString() ?? null,
        numero_guia: fila.numeroGuia,
        transportadora: fila.transportadora,
        ciudad_destino: fila.ciudadDestino,
        lineas: [],
      };
      ordenes.set(fila.idOrden, orden);
    } else {
      // Todas las filas de un combo traen los mismos datos de cabecera, pero
      // si alguna llega incompleta se completa con la que sí los traiga.
      orden.fecha_guia_generada ??= fila.fechaGuiaGenerada?.toISOString() ?? null;
      orden.numero_guia ??= fila.numeroGuia;
      orden.transportadora ??= fila.transportadora;
      orden.ciudad_destino ??= fila.ciudadDestino;
    }

    // La suma por (orden, producto, variación) la resuelve `procesar_carga`
    // con un GROUP BY, para que coincida exactamente con el unique de la tabla.
    orden.lineas.push({
      producto_id: fila.productoId,
      variacion_id: fila.variacionId,
      cantidad: fila.cantidad,
      // Posición en el archivo: el Reporte Ordenado ancla el combo al producto
      // de línea más baja.
      linea: orden.lineas.length + 1,
    });
  }

  return {
    archivo,
    productos: [...productos.values()],
    variaciones: [...variaciones.values()],
    ordenes: [...ordenes.values()],
  };
}
