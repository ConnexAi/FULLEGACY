import Link from "next/link";
import { notFound } from "next/navigation";

import {
  AvisoDeVista,
  SelectorVista,
} from "@/app/cargas/[id]/selector-vista";
import {
  ConteoPorProducto,
  TablaReporte,
} from "@/app/cargas/[id]/tabla-reporte";
import { obtenerCargaConReporte } from "@/lib/reportes/consulta-carga";
import { leerVista } from "@/lib/reportes/vista";

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
 *
 * `?vista=original` muestra la foto del archivo en lugar del estado de ahora.
 * Las dos lecturas pueden contradecirse — una orden PENDIENTE en la foto puede
 * estar despachada en vivo — así que la pantalla dice cuál se está mirando.
 */
export default async function PaginaCarga({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ vista?: string }>;
}) {
  const [{ id }, { vista: vistaPedida }] = await Promise.all([
    params,
    searchParams,
  ]);
  const cargaId = Number(id);

  if (!Number.isInteger(cargaId) || cargaId <= 0) notFound();

  const datos = await obtenerCargaConReporte(cargaId, leerVista(vistaPedida));
  if (!datos) notFound();

  const { carga, reporte, vista, tieneFoto } = datos;
  const subidoEn = FORMATO_FECHA.format(new Date(carga.creado_en));

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
          {subidoEn} · {carga.ordenes_nuevas} nuevas ·{" "}
          {carga.ordenes_actualizadas} actualizadas · {carga.ordenes_sin_cambios}{" "}
          sin cambios
        </p>
      </header>

      <section className="flex flex-col gap-4">
        {/*
          El selector solo aparece si hay foto que mostrar. Las cargas
          anteriores al registro histórico no la tienen, y ofrecer una vista
          que caería de vuelta en la de en vivo sería mentirle a Diego.
        */}
        {tieneFoto ? <SelectorVista cargaId={cargaId} vista={vista} /> : null}

        <AvisoDeVista vista={vista} subidoEn={subidoEn} tieneFoto={tieneFoto} />

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold">
              {vista === "original"
                ? "Reporte Ordenado · como se subió originalmente"
                : "Reporte Ordenado · estado de ahora"}
            </h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              {reporte.totalPedidos}{" "}
              {vista === "original"
                ? "pedidos estaban por despachar"
                : "pedidos por despachar"}{" "}
              · {reporte.totalUnidades} unidades · agrupado por producto A→Z y
              cantidad ascendente
            </p>
          </div>

          {reporte.filas.length > 0 ? (
            <a
              href={
                vista === "original"
                  ? `/api/cargas/${cargaId}/excel?vista=original`
                  : `/api/cargas/${cargaId}/excel`
              }
              className="inline-flex items-center gap-2 rounded-lg bg-[#3B6EA5] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#325d8c]"
            >
              <IconoDescarga />
              {vista === "original"
                ? "Descargar Excel de la foto"
                : "Descargar Excel"}
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
