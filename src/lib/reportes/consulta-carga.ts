import "server-only";

import {
  construirReporteOrdenado,
  type LineaCarga,
  type ReporteOrdenado,
} from "@/lib/reportes/reporte-ordenado";
import {
  VISTA_POR_DEFECTO,
  type VistaReporte,
} from "@/lib/reportes/vista";
import { crearClienteServidor } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

type Carga = Database["public"]["Tables"]["cargas"]["Row"];

export {
  leerVista,
  ROTULO_VISTA,
  VISTA_POR_DEFECTO,
  type VistaReporte,
} from "@/lib/reportes/vista";

export interface CargaConReporte {
  carga: Carga;
  reporte: ReporteOrdenado;
  vista: VistaReporte;
  /**
   * Si esta carga tiene foto. Las anteriores al registro histórico no la
   * tienen, y para esas no se ofrece la vista original.
   */
  tieneFoto: boolean;
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
  vistaPedida: VistaReporte = VISTA_POR_DEFECTO,
): Promise<CargaConReporte | null> {
  const supabase = await crearClienteServidor();

  const [
    { data: carga, error: errorCarga },
    { count: filasFoto, error: errorFoto },
  ] = await Promise.all([
    supabase.from("cargas").select("*").eq("id", cargaId).maybeSingle(),
    supabase
      .from("carga_ordenes_foto")
      .select("id_orden", { count: "exact", head: true })
      .eq("carga_id", cargaId),
  ]);

  if (errorCarga) throw new Error(errorCarga.message);
  if (errorFoto) throw new Error(errorFoto.message);
  if (!carga) return null;

  const tieneFoto = (filasFoto ?? 0) > 0;
  // Una carga anterior al registro histórico no tiene foto que mostrar: se
  // cae a la vista en vivo en lugar de devolver un reporte vacío.
  const vista: VistaReporte = vistaPedida === "original" && tieneFoto ? "original" : "vivo";

  // Las dos vistas exponen exactamente las mismas columnas, así que el armado
  // del reporte es el mismo y solo cambia de dónde salen las líneas.
  const origen = vista === "original" ? "v_lineas_carga_foto" : "v_lineas_carga";

  const { data: lineas, error: errorLineas } = await supabase
    .from(origen)
    .select("*")
    .eq("carga_id", cargaId)
    // El filtro del Reporte Ordenado: solo lo que está por despachar.
    // `estado_normalizado` ya viene en mayúsculas y sin espacios sobrantes.
    .like("estado_normalizado", "PENDIENTE%");

  if (errorLineas) throw new Error(errorLineas.message);

  return {
    carga,
    reporte: construirReporteOrdenado((lineas ?? []) as LineaCarga[]),
    vista,
    tieneFoto,
  };
}
