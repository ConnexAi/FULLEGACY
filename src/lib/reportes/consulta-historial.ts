import "server-only";

import {
  ESTADOS_NO_COMPLETADOS,
  construirHistorialMensual,
  resumirPorDia,
  type AgregadoDia,
  type HistorialMensual,
  type Producto,
  type ResumenDelMes,
} from "@/lib/reportes/historial-mensual";
import { crearClienteServidor } from "@/lib/supabase/server";

/**
 * Arma el historial de un mes contra la base, en el momento de pedirlo.
 *
 * No hay archivo persistido ni paso de "actualizar": lo que Diego suba queda
 * reflejado en la siguiente descarga.
 */
export async function obtenerHistorialMensual(
  anio: number,
  mes: number,
): Promise<HistorialMensual> {
  const supabase = await crearClienteServidor();

  const [{ data: productos, error: errorProductos }, { data: agregados, error: errorAgregados }] =
    await Promise.all([
      // Todos los productos del catálogo, no solo los que vendieron este mes:
      // un producto sin pedidos igual tiene su hoja, con los días en cero.
      supabase.from("productos").select("id, nombre").order("nombre"),
      supabase.rpc("historial_mensual", {
        p_anio: anio,
        p_mes: mes,
        p_estados_no_completados: [...ESTADOS_NO_COMPLETADOS],
      }),
    ]);

  if (errorProductos) throw new Error(errorProductos.message);
  if (errorAgregados) throw new Error(errorAgregados.message);

  return construirHistorialMensual(
    anio,
    mes,
    (productos ?? []) as Producto[],
    (agregados ?? []) as AgregadoDia[],
  );
}

/** Totales por producto del mes, para el dashboard. */
export interface TotalProducto {
  producto: string;
  pedidos: number;
  unidades: number;
}

export async function obtenerTotalesDelMes(
  anio: number,
  mes: number,
): Promise<TotalProducto[]> {
  const historial = await obtenerHistorialMensual(anio, mes);

  return historial.hojas
    .filter((hoja) => hoja.totalPedidos > 0 || hoja.totalUnidades > 0)
    .map((hoja) => ({
      producto: hoja.producto.nombre,
      pedidos: hoja.totalPedidos,
      unidades: hoja.totalUnidades,
    }))
    .sort((a, b) => b.unidades - a.unidades || b.pedidos - a.pedidos);
}

/**
 * Pedidos por día del mes, sumados sobre todos los productos.
 *
 * Usa la misma agregación que el historial (`historial_mensual()`), pero sin
 * traer el catálogo ni armar las hojas: en la página de inicio es un vistazo,
 * no el reporte.
 */
export async function obtenerResumenDelMes(
  anio: number,
  mes: number,
  hastaHoy?: number,
): Promise<ResumenDelMes> {
  const supabase = await crearClienteServidor();

  const { data, error } = await supabase.rpc("historial_mensual", {
    p_anio: anio,
    p_mes: mes,
    p_estados_no_completados: [...ESTADOS_NO_COMPLETADOS],
  });

  if (error) throw new Error(error.message);

  return resumirPorDia(anio, mes, (data ?? []) as AgregadoDia[], hastaHoy);
}
