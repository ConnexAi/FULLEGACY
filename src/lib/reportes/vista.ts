/**
 * Las dos lecturas posibles del Reporte Ordenado de una carga.
 *
 * `vivo`     — el estado de ahora de las órdenes que hoy cuelgan de esa carga.
 *              Es lo que Diego usa para alistar: una orden ya despachada
 *              desaparece sola.
 * `original` — la foto del archivo tal como se subió. Los estados son los de
 *              ese momento y no cambian nunca.
 *
 * La misma orden puede verse PENDIENTE en una y despachada en la otra: son
 * preguntas distintas, no versiones de la misma.
 *
 * Vive en su propio módulo, sin `server-only`, porque lo necesitan tanto la
 * consulta como el armado del Excel y la pantalla.
 */
export type VistaReporte = "vivo" | "original";

export const VISTA_POR_DEFECTO: VistaReporte = "vivo";

/** Lee el `?vista=` de la URL. Cualquier otro valor cae en la vista en vivo. */
export function leerVista(valor: string | undefined): VistaReporte {
  return valor === "original" ? "original" : VISTA_POR_DEFECTO;
}

/** Cómo se nombra cada vista donde haga falta decirlo en palabras. */
export const ROTULO_VISTA: Record<VistaReporte, string> = {
  vivo: "Estado de ahora",
  original: "Como se subió originalmente",
};
