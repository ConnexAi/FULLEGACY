import Link from "next/link";
import { notFound } from "next/navigation";

import {
  ConteoPorProducto,
  TablaReporte,
} from "@/app/cargas/[id]/tabla-reporte";
import { obtenerCargaConReporte } from "@/lib/reportes/consulta-carga";

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
 * La descarga en Excel sale de la misma consulta, así que el orden en pantalla
 * y el del archivo son idénticos.
 */
export default async function PaginaCarga({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cargaId = Number(id);

  if (!Number.isInteger(cargaId) || cargaId <= 0) notFound();

  const datos = await obtenerCargaConReporte(cargaId);
  if (!datos) notFound();

  const { carga, reporte } = datos;

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
          {carga.ordenes_nuevas} nuevas · {carga.ordenes_actualizadas}{" "}
          actualizadas · {carga.ordenes_sin_cambios} sin cambios
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold">Reporte Ordenado</h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              {reporte.totalPedidos} pedidos por despachar ·{" "}
              {reporte.totalUnidades} unidades · agrupado por producto A→Z y
              cantidad ascendente
            </p>
          </div>

          {reporte.filas.length > 0 ? (
            <a
              href={`/api/cargas/${cargaId}/excel`}
              className="inline-flex items-center gap-2 rounded-lg bg-[#3B6EA5] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#325d8c]"
            >
              <IconoDescarga />
              Descargar Excel
            </a>
          ) : null}
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

function IconoDescarga() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 2v8m0 0L5 7m3 3 3-3" />
      <path d="M2.5 11v1.5A1.5 1.5 0 0 0 4 14h8a1.5 1.5 0 0 0 1.5-1.5V11" />
    </svg>
  );
}
