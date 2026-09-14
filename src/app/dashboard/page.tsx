import Link from "next/link";
import { Suspense } from "react";

import { BarrasPorProducto, TortaUnidades } from "@/app/dashboard/graficos";
import { SelectorMes } from "@/components/selector-mes";
import {
  obtenerResumenDelMes,
  obtenerTotalesDelMes,
} from "@/lib/reportes/consulta-historial";
import { etiquetaDeMes } from "@/lib/reportes/historial-mensual";
import { leerValorMes, mesActualEnBogota, ultimosMeses } from "@/lib/reportes/meses";

export const metadata = { title: "Dashboard · FULLEGACY" };
export const dynamic = "force-dynamic";

const MESES_A_MOSTRAR = 18;

export default async function PaginaDashboard({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const { mes: mesEnUrl } = await searchParams;

  const opciones = ultimosMeses(MESES_A_MOSTRAR);
  const elegido = leerValorMes(mesEnUrl) ?? mesActualEnBogota();
  const valor = `${elegido.anio}-${String(elegido.mes).padStart(2, "0")}`;

  // El desglose por producto y los totales del mes salen de fuentes distintas
  // a propósito: por producto, una orden-combo cuenta en cada producto que
  // contiene (correcto); en el total del mes cuenta una sola vez.
  const [totales, resumen] = await Promise.all([
    obtenerTotalesDelMes(elegido.anio, elegido.mes),
    obtenerResumenDelMes(elegido.anio, elegido.mes),
  ]);

  const pedidos = resumen.totalPedidos;
  const unidades = resumen.totalUnidades;

  // Si hay combos, la columna del desglose suma más que el total: se avisa.
  const pedidosPorProducto = totales.reduce((n, t) => n + t.pedidos, 0);
  const hayCombos = pedidosPorProducto !== pedidos;

  return (
    <main className="viz-root mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-6 py-12">
      <header className="flex flex-col gap-1">
        <Link
          href="/"
          className="text-sm text-neutral-500 hover:underline dark:text-neutral-400"
        >
          ← Inicio
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Pedidos y unidades despachadas por producto. Cuentan solo las órdenes
          con fecha de guía generada.
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-4">
        <Suspense fallback={null}>
          <SelectorMes opciones={opciones} seleccionado={valor} />
        </Suspense>
      </div>

      {/* Los números de titular son cifras, no un gráfico de una barra. */}
      <section className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
        <Cifra etiqueta="Pedidos despachados" valor={pedidos} />
        <Cifra etiqueta="Unidades despachadas" valor={unidades} />
        <Cifra etiqueta="Productos con movimiento" valor={totales.length} />
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-lg font-semibold">
            Participación de unidades · {etiquetaDeMes(elegido.anio, elegido.mes)}
          </h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Qué parte del volumen despachado aporta cada producto.
          </p>
        </div>
        <TortaUnidades datos={totales} />
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-lg font-semibold">Pedidos y unidades por producto</h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Pasa el cursor sobre una fila para ver sus dos valores.
          </p>
        </div>
        <BarrasPorProducto datos={totales} />
      </section>

      {/* Vista de tabla: el mismo dato sin depender del color ni del hover. */}
      {totales.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Detalle</h2>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-black/15 text-left dark:border-white/20">
                  <th className="py-2 pr-4 text-xs font-semibold">PRODUCTO</th>
                  <th className="py-2 pr-4 text-right text-xs font-semibold">PEDIDOS</th>
                  <th className="py-2 text-right text-xs font-semibold">UNIDADES</th>
                </tr>
              </thead>
              <tbody>
                {totales.map((fila) => (
                  <tr
                    key={fila.producto}
                    className="border-b border-black/5 last:border-0 dark:border-white/10"
                  >
                    <td className="py-2 pr-4">{fila.producto}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{fila.pedidos}</td>
                    <td className="py-2 text-right tabular-nums">{fila.unidades}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-black/15 font-medium dark:border-white/20">
                  <td className="py-2 pr-4">Total</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{pedidos}</td>
                  <td className="py-2 text-right tabular-nums">{unidades}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {hayCombos ? (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              El total cuenta cada orden una sola vez. Una orden con varios
              productos aparece en la fila de cada uno, por eso la columna suma{" "}
              {pedidosPorProducto}.
            </p>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}

function Cifra({ etiqueta, valor }: { etiqueta: string; valor: number }) {
  return (
    <div>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">{etiqueta}</p>
      <p className="text-3xl font-semibold tabular-nums">
        {valor.toLocaleString("es-CO")}
      </p>
    </div>
  );
}
