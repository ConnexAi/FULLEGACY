import type { ReporteOrdenado } from "@/lib/reportes/reporte-ordenado";

const COLUMNAS = [
  "TIPO",
  "PRODUCTO",
  "VARIACION",
  "CANTIDAD",
  "N GUIA",
  "ID ORDEN",
  "TRANSPORTADORA",
  "CIUDAD DESTINO",
] as const;

const VACIO = "—";

export function TablaReporte({ reporte }: { reporte: ReporteOrdenado }) {
  if (reporte.filas.length === 0) {
    return (
      <p className="rounded-lg border border-black/10 px-4 py-3 text-sm text-neutral-600 dark:border-white/15 dark:text-neutral-300">
        Esta carga no trajo órdenes por despachar. El Reporte Ordenado solo
        incluye las órdenes cuyo estado empieza por <code>PENDIENTE</code>.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-4xl border-collapse text-sm">
        <thead>
          <tr className="border-b border-black/15 text-left dark:border-white/20">
            {COLUMNAS.map((columna) => (
              <th
                key={columna}
                className={`py-2 pr-4 text-xs font-semibold tracking-wide whitespace-nowrap ${
                  columna === "CANTIDAD" ? "text-right" : ""
                }`}
              >
                {columna}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {reporte.filas.map((fila) => (
            <tr
              key={`${fila.idOrden}-${fila.producto}`}
              className="border-b border-black/5 last:border-0 dark:border-white/10"
            >
              <td className="py-2 pr-4">
                <span
                  className={`rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${
                    fila.tipo === "COMBO"
                      ? "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200"
                      : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                  }`}
                >
                  {fila.tipo}
                </span>
              </td>
              <td className="py-2 pr-4">{fila.producto}</td>
              <td className="py-2 pr-4 whitespace-nowrap">{fila.variacion}</td>
              <td className="py-2 pr-4 text-right tabular-nums">
                {fila.cantidad}
              </td>
              <td className="py-2 pr-4 font-mono text-xs whitespace-nowrap">
                {fila.numeroGuia ?? VACIO}
              </td>
              <td className="py-2 pr-4 font-mono text-xs whitespace-nowrap">
                {fila.idOrden}
              </td>
              <td className="py-2 pr-4 whitespace-nowrap">
                {fila.transportadora ?? VACIO}
              </td>
              <td className="py-2 whitespace-nowrap">
                {fila.ciudadDestino ?? VACIO}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ConteoPorProducto({ reporte }: { reporte: ReporteOrdenado }) {
  if (reporte.conteoPorProducto.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full max-w-xl border-collapse text-sm">
        <thead>
          <tr className="border-b border-black/15 text-left dark:border-white/20">
            <th className="py-2 pr-4 text-xs font-semibold">PRODUCTO</th>
            <th className="py-2 pr-4 text-right text-xs font-semibold">
              PEDIDOS
            </th>
            <th className="py-2 text-right text-xs font-semibold">UNIDADES</th>
          </tr>
        </thead>
        <tbody>
          {reporte.conteoPorProducto.map((linea) => (
            <tr
              key={linea.producto}
              className="border-b border-black/5 last:border-0 dark:border-white/10"
            >
              <td className="py-2 pr-4">{linea.producto}</td>
              <td className="py-2 pr-4 text-right tabular-nums">
                {linea.pedidos}
              </td>
              {/*
                En un combo las unidades van vacías: ya están contadas en las
                filas de los productos que lo componen.
              */}
              <td className="py-2 text-right tabular-nums">
                {linea.unidades ?? VACIO}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-black/15 font-medium dark:border-white/20">
            <td className="py-2 pr-4">Total</td>
            <td className="py-2 pr-4 text-right tabular-nums">
              {reporte.totalPedidos}
            </td>
            <td className="py-2 text-right tabular-nums">
              {reporte.totalUnidades}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
