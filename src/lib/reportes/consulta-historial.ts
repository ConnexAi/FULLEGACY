import "server-only";

import {
  ESTADOS_NO_COMPLETADOS,
  aplanarHistorialMensual,
  construirHistorialMensual,
  construirHistorialPorOrden,
  resumirPorDia,
  type DiaConOrdenes,
  type FilaHistorialMensual,
  type HistorialMensual,
  type Producto,
  type ResumenDelMes,
  type TotalDia,
} from "@/lib/reportes/historial-mensual";
import { crearClienteServidor } from "@/lib/supabase/server";

/**
 * Arma el historial de un mes contra la base, en el momento de pedirlo. Es el
 * del Excel y la pantalla /historial.
 *
 * Cada orden cuenta en una sola hoja: las normales en la de su producto y los
 * combos en la hoja Combos (ver `construirHistorialPorOrden`).
 *
 * No hay archivo persistido ni paso de "actualizar": lo que Diego suba queda
 * reflejado en la siguiente descarga.
 */
export async function obtenerHistorialMensual(
  anio: number,
  mes: number,
): Promise<HistorialMensual> {
  const supabase = await crearClienteServidor();

  const [{ data: productos, error: errorProductos }, { data: dias, error: errorDias }] =
    await Promise.all([
      supabase.from("productos").select("id, nombre").order("nombre"),
      // Una fila por día (máximo 31) con las órdenes adentro: el número de
      // filas no depende de cuántas órdenes tenga el mes.
      supabase.rpc("historial_mensual_ordenes", { p_anio: anio, p_mes: mes }),
    ]);

  if (errorProductos) throw new Error(errorProductos.message);
  if (errorDias) throw new Error(errorDias.message);

  return construirHistorialPorOrden(
    anio,
    mes,
    (productos ?? []) as Producto[],
    (dias ?? []) as unknown as DiaConOrdenes[],
  );
}

/**
 * Historial agregado por producto, donde un combo cuenta un pedido en cada
 * producto que lo compone. Solo lo usa el dashboard, que no cambia con la
 * hoja Combos del Excel.
 */
async function obtenerHistorialPorProducto(
  anio: number,
  mes: number,
): Promise<HistorialMensual> {
  const supabase = await crearClienteServidor();

  const [{ data: productos, error: errorProductos }, { data: filas, error: errorFilas }] =
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
  if (errorFilas) throw new Error(errorFilas.message);

  // `historial_mensual()` viene una fila por producto, con los días agregados
  // adentro (ver la migración): se aplana acá, en el único lugar que conoce
  // ese contrato, antes de pasarla a la lógica de negocio.
  const agregados = aplanarHistorialMensual(
    (filas ?? []) as unknown as FilaHistorialMensual[],
  );

  return construirHistorialMensual(anio, mes, (productos ?? []) as Producto[], agregados);
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
  // `historial.hojas` ya viene filtrada a los productos con pedidos este mes
  // (ver construirHistorialMensual), así que no hace falta filtrar de nuevo.
  const historial = await obtenerHistorialPorProducto(anio, mes);

  return historial.hojas
    .map((hoja) => ({
      producto: hoja.producto.nombre,
      pedidos: hoja.totalPedidos,
      unidades: hoja.totalUnidades,
    }))
    .sort((a, b) => b.unidades - a.unidades || b.pedidos - a.pedidos);
}

/**
 * Pedidos y unidades por día del mes, agregados sobre todos los productos.
 *
 * Usa `totales_diarios()` y no `historial_mensual()`: esa cuenta por producto,
 * y sumar sus filas contaría dos veces cada orden-combo. Acá cada orden cuenta
 * una sola vez.
 */
export async function obtenerResumenDelMes(
  anio: number,
  mes: number,
  hastaHoy?: number,
): Promise<ResumenDelMes> {
  const supabase = await crearClienteServidor();

  const { data, error } = await supabase.rpc("totales_diarios", {
    p_anio: anio,
    p_mes: mes,
  });

  if (error) throw new Error(error.message);

  return resumirPorDia(anio, mes, (data ?? []) as TotalDia[], hastaHoy);
}
