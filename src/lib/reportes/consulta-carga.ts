import "server-only";

import {
  construirReporteOrdenado,
  type LineaCarga,
  type ReporteOrdenado,
} from "@/lib/reportes/reporte-ordenado";
import { crearClienteServidor } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

type Carga = Database["public"]["Tables"]["cargas"]["Row"];

export interface CargaConReporte {
  carga: Carga;
  reporte: ReporteOrdenado;
}

/**
 * Trae una carga y su Reporte Ordenado.
 *
 * Vive acá para que la pantalla y la descarga en Excel salgan exactamente del
 * mismo dato y del mismo orden: si divergieran, Diego imprimiría guías en un
 * orden distinto al que ve.
 *
 * Se consulta con la sesión de Diego, así que aplican las policies de RLS.
 */
export async function obtenerCargaConReporte(
  cargaId: number,
): Promise<CargaConReporte | null> {
  const supabase = await crearClienteServidor();

  const [{ data: carga, error: errorCarga }, { data: lineas, error: errorLineas }] =
    await Promise.all([
      supabase.from("cargas").select("*").eq("id", cargaId).maybeSingle(),
      supabase
        .from("v_lineas_carga")
        .select("*")
        .eq("carga_id", cargaId)
        // El filtro del Reporte Ordenado: solo lo que está por despachar.
        // `estado_normalizado` ya viene en mayúsculas y sin espacios sobrantes.
        .like("estado_normalizado", "PENDIENTE%"),
    ]);

  if (errorCarga) throw new Error(errorCarga.message);
  if (errorLineas) throw new Error(errorLineas.message);
  if (!carga) return null;

  return {
    carga,
    reporte: construirReporteOrdenado((lineas ?? []) as LineaCarga[]),
  };
}
