import { extraerUnidades } from "@/lib/dropi/unidades";
import type { CargaParaGuardar, FilaDropi } from "@/lib/dropi/tipos";

/**
 * Agrupa las filas ya validadas en la estructura que espera `procesar_carga`.
 *
 * Aquí es donde se arma el combo: todas las filas que comparten el mismo
 * `ID` de orden se convierten en varias líneas de una misma orden.
 */
export function agruparCarga(filas: FilaDropi[]): CargaParaGuardar {
  const productos = new Map<number, { id: number; nombre: string }>();
  const variaciones = new Map<number, CargaParaGuardar["variaciones"][number]>();
  const ordenes = new Map<number, CargaParaGuardar["ordenes"][number]>();

  for (const fila of filas) {
    // --- catálogo -------------------------------------------------------
    // Gana la última aparición dentro del archivo: si el nombre cambió a
    // mitad del export, se queda el más reciente.
    productos.set(fila.productoId, {
      id: fila.productoId,
      nombre: fila.productoNombre,
    });

    variaciones.set(fila.variacionId, {
      id: fila.variacionId,
      producto_id: fila.productoId,
      sku: fila.sku,
      texto_variacion: fila.textoVariacion,
      unidades_extraidas: extraerUnidades(fila.textoVariacion),
    });

    // --- orden ----------------------------------------------------------
    let orden = ordenes.get(fila.idOrden);

    if (!orden) {
      orden = {
        id_orden: fila.idOrden,
        estado: fila.estado,
        fecha_orden: fila.fechaOrden.toISOString(),
        fecha_guia_generada: fila.fechaGuiaGenerada?.toISOString() ?? null,
        numero_guia: fila.numeroGuia,
        lineas: [],
      };
      ordenes.set(fila.idOrden, orden);
    } else {
      // Todas las filas de un combo traen los mismos datos de cabecera, pero
      // si alguna llega incompleta se completa con la que sí los traiga.
      orden.fecha_guia_generada ??= fila.fechaGuiaGenerada?.toISOString() ?? null;
      orden.numero_guia ??= fila.numeroGuia;
    }

    // La suma por (orden, variación) la resuelve `procesar_carga` con un
    // GROUP BY, para que coincida exactamente con el unique de la tabla.
    orden.lineas.push({
      variacion_id: fila.variacionId,
      cantidad: fila.cantidad,
    });
  }

  return {
    productos: [...productos.values()],
    variaciones: [...variaciones.values()],
    ordenes: [...ordenes.values()],
  };
}
