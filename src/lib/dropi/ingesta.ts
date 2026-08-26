import "server-only";

import { agruparCarga } from "@/lib/dropi/carga";
import { parsearExcelDropi } from "@/lib/dropi/parser";
import {
  ErrorArchivoDropi,
  type ResumenArchivo,
  type ResumenGuardado,
} from "@/lib/dropi/tipos";
import { crearClienteAdmin } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";

/** Cuántos errores de fila se devuelven al navegador (el conteo total sí es completo). */
const MAX_ERRORES_MOSTRADOS = 25;

/**
 * Procesa un archivo de Dropi de punta a punta: leer, agrupar y guardar.
 *
 * El guardado entero ocurre dentro de `procesar_carga`, que Postgres corre
 * como una transacción: si algo falla a mitad, no queda nada a medias.
 */
export async function ingerirArchivo(
  nombre: string,
  buffer: ArrayBuffer,
): Promise<ResumenArchivo> {
  try {
    const { filas, errores, filasLeidas } = await parsearExcelDropi(buffer);

    if (filas.length === 0) {
      return {
        archivo: nombre,
        ok: false,
        error:
          "Ninguna fila del archivo se pudo leer correctamente. Revisa el detalle de errores.",
        filasLeidas,
        filasConError: errores.length,
        erroresMuestra: errores.slice(0, MAX_ERRORES_MOSTRADOS),
        ordenesEnArchivo: 0,
        ordenesNuevas: 0,
        ordenesOmitidas: 0,
        ordenesIncompletas: 0,
        lineasInsertadas: 0,
        productosNuevos: 0,
        variacionesNuevas: 0,
      };
    }

    const carga = agruparCarga(filas, {
      nombre: nombre,
      filas_leidas: filasLeidas,
      filas_con_error: errores.length,
    });

    const supabase = crearClienteAdmin();
    const { data, error } = await supabase.rpc("procesar_carga", {
      // `CargaParaGuardar` es JSON válido, pero TypeScript no lo reconoce como
      // `Json` porque una interfaz no tiene index signature.
      p_carga: carga as unknown as Json,
    });

    if (error) {
      throw new ErrorArchivoDropi(
        `No se pudo guardar la carga: ${error.message}. No quedó nada guardado de este archivo.`,
      );
    }

    const resumen = data as unknown as ResumenGuardado;
    const omitidos = new Set(resumen.ids_omitidos ?? []);

    // Órdenes que sí se guardaron pero perdieron alguna línea porque una fila
    // del combo venía mal. Se avisan aparte: el dato quedó incompleto.
    const idsConError = new Set(
      errores
        .map((e) => e.idOrden)
        .filter((id): id is number => id !== null && !omitidos.has(id)),
    );
    const ordenesIncompletas = carga.ordenes.filter((o) =>
      idsConError.has(o.id_orden),
    ).length;

    return {
      archivo: nombre,
      ok: true,
      cargaId: Number(resumen.carga_id),
      filasLeidas,
      filasConError: errores.length,
      erroresMuestra: errores.slice(0, MAX_ERRORES_MOSTRADOS),
      ordenesEnArchivo: carga.ordenes.length,
      ordenesNuevas: Number(resumen.ordenes_nuevas ?? 0),
      ordenesOmitidas: Number(resumen.ordenes_omitidas ?? 0),
      ordenesIncompletas,
      lineasInsertadas: Number(resumen.lineas_insertadas ?? 0),
      productosNuevos: Number(resumen.productos_nuevos ?? 0),
      variacionesNuevas: Number(resumen.variaciones_nuevas ?? 0),
    };
  } catch (error) {
    const mensaje =
      error instanceof ErrorArchivoDropi
        ? error.message
        : "Error inesperado procesando el archivo.";

    if (!(error instanceof ErrorArchivoDropi)) {
      console.error(`[ingesta] fallo procesando "${nombre}":`, error);
    }

    return {
      archivo: nombre,
      ok: false,
      error: mensaje,
      filasLeidas: 0,
      filasConError: 0,
      erroresMuestra: [],
      ordenesEnArchivo: 0,
      ordenesNuevas: 0,
      ordenesOmitidas: 0,
      ordenesIncompletas: 0,
      lineasInsertadas: 0,
      productosNuevos: 0,
      variacionesNuevas: 0,
    };
  }
}
