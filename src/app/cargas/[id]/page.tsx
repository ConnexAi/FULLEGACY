import Link from "next/link";
import { notFound } from "next/navigation";

import {
  ConteoPorProducto,
  TablaReporte,
} from "@/app/cargas/[id]/tabla-reporte";
import {
  construirReporteOrdenado,
  type LineaCarga,
} from "@/lib/reportes/reporte-ordenado";
import { crearClienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const FORMATO_FECHA = new Intl.DateTimeFormat("es-CO", {
  dateStyle: "full",
  timeStyle: "short",
  timeZone: "America/Bogota",
});

/**
 * Reporte Ordenado de una carga.
 *
 * Solo entran las órdenes por despachar (estado que empieza por "PENDIENTE").
 * El filtro por prefijo se hace en SQL sobre `estado_normalizado`, que la
 * vista ya deja en mayúsculas y sin espacios sobrantes.
 */
export default async function PaginaCarga({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cargaId = Number(id);

  if (!Number.isInteger(cargaId) || cargaId <= 0) notFound();

  const supabase = await crearClienteServidor();

  const [{ data: carga, error: errorCarga }, { data: lineas, error: errorLineas }] =
    await Promise.all([
      supabase.from("cargas").select("*").eq("id", cargaId).maybeSingle(),
      supabase
        .from("v_lineas_carga")
        .select("*")
        .eq("carga_id", cargaId)
        .like("estado_normalizado", "PENDIENTE%"),
    ]);

  if (errorCarga) throw new Error(errorCarga.message);
  if (!carga) notFound();
  if (errorLineas) throw new Error(errorLineas.message);

  const reporte = construirReporteOrdenado((lineas ?? []) as LineaCarga[]);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-6 py-12">
      <header className="flex flex-col gap-1">
        <Link
          href="/cargas"
          className="text-sm text-neutral-500 hover:underline dark:text-neutral-400"
        >
          ← Cargas
        </Link>
        <h1 className="font-mono text-xl font-semibold break-all">
          {carga.nombre_archivo}
        </h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          {FORMATO_FECHA.format(new Date(carga.creado_en))} ·{" "}
          {carga.ordenes_nuevas} órdenes nuevas · {carga.ordenes_omitidas}{" "}
          omitidas
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Reporte Ordenado</h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {reporte.totalPedidos} pedidos por despachar ·{" "}
            {reporte.totalUnidades} unidades · agrupado por producto A→Z y
            cantidad ascendente
          </p>
        </div>
        <TablaReporte reporte={reporte} />
      </section>

      {reporte.conteoPorProducto.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Conteo por producto</h2>
          <ConteoPorProducto reporte={reporte} />
        </section>
      ) : null}
    </main>
  );
}
