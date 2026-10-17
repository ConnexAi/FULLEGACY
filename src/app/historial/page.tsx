import Link from "next/link";
import { Suspense } from "react";

import { SelectorMes } from "@/components/selector-mes";
import { obtenerHistorialMensual } from "@/lib/reportes/consulta-historial";
import { AVISO_PRELIMINAR, ESTADOS_NO_COMPLETADOS } from "@/lib/reportes/historial-mensual";
import { leerValorMes, mesActualEnBogota, ultimosMeses } from "@/lib/reportes/meses";

export const metadata = { title: "Historial mensual · FULLEGACY" };
export const dynamic = "force-dynamic";

const MESES_A_MOSTRAR = 18;

export default async function PaginaHistorial({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const { mes: mesEnUrl } = await searchParams;

  const opciones = ultimosMeses(MESES_A_MOSTRAR);
  const elegido = leerValorMes(mesEnUrl) ?? mesActualEnBogota();
  const valor = `${elegido.anio}-${String(elegido.mes).padStart(2, "0")}`;

  const historial = await obtenerHistorialMensual(elegido.anio, elegido.mes);

  // Cada orden cuenta una sola vez (en su producto o en Combos), y las
  // unidades incluyen las de productos que solo vinieron en combos.
  const { totalPedidos, totalUnidades } = historial;
  const sinMovimiento = historial.hojas.length === 0 && !historial.combos;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-1">
        <Link
          href="/"
          className="text-sm text-neutral-500 hover:underline dark:text-neutral-400"
        >
          ← Inicio
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Historial mensual</h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Un Excel con una hoja por producto, una hoja de combos y una fila
          por día del mes. Se arma con los datos que haya en el momento de
          descargarlo.
        </p>
      </header>

      <section className="flex flex-wrap items-end gap-4">
        <Suspense fallback={null}>
          <SelectorMes opciones={opciones} seleccionado={valor} />
        </Suspense>

        <a
          href={`/api/historial/${elegido.anio}/${elegido.mes}/excel`}
          className="inline-flex items-center gap-2 rounded-lg bg-[#3B6EA5] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#325d8c]"
        >
          <IconoDescarga />
          Descargar Excel
        </a>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{historial.etiquetaMes}</h2>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          <Dato etiqueta="Pedidos despachados" valor={totalPedidos} />
          <Dato etiqueta="Unidades" valor={totalUnidades} />
          <div>
            <dt className="text-xs text-neutral-500 dark:text-neutral-400">
              Hojas en el archivo
            </dt>
            <dd className="text-xl font-semibold tabular-nums">
              {historial.hojas.length}
              <span className="ml-1 text-sm font-normal text-neutral-500 dark:text-neutral-400">
                de {historial.totalProductosEnCatalogo} en el catálogo
                {historial.combos ? " + Combos" : ""}
              </span>
            </dd>
          </div>
        </dl>

        {sinMovimiento ? (
          <p className="rounded-lg border border-black/10 px-4 py-3 text-sm text-neutral-600 dark:border-white/15 dark:text-neutral-300">
            Este mes todavía no tiene órdenes con guía generada. El Excel se
            descarga igual, con una hoja avisando que no hubo movimiento.
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-2 rounded-lg border border-black/10 px-4 py-3 text-sm text-neutral-600 dark:border-white/15 dark:text-neutral-300">
        <p className="font-medium text-neutral-800 dark:text-neutral-100">
          Qué trae cada hoja
        </p>
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            Solo cuentan las órdenes con <strong>fecha de guía generada</strong>:
            sin guía, la orden nunca salió a despacho.
          </li>
          <li>
            La columna de <strong>devoluciones en bodega</strong> va en blanco,
            para llenarla a mano.
          </li>
          <li>
            <strong>No completados</strong> cuenta las órdenes despachadas que
            quedaron en {ESTADOS_NO_COMPLETADOS.join(", ")}. {AVISO_PRELIMINAR}
          </li>
          <li>
            Cada orden cuenta en <strong>una sola hoja</strong>: la de su
            producto si trae uno solo, o la hoja <strong>Combos</strong> si
            trae varios. Las unidades de un combo sí suman en la hoja de cada
            producto que contiene.
          </li>
          <li>Los jueves quedan marcados con un fondo azul tenue.</li>
          <li>
            Un producto sin pedidos propios ese mes no genera hoja (si solo
            vino en combos, se ve en el detalle de la hoja Combos) — así el
            archivo no se llena de hojas en cero a medida que crece el
            catálogo.
          </li>
        </ul>
      </section>
    </main>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: number }) {
  return (
    <div>
      <dt className="text-xs text-neutral-500 dark:text-neutral-400">{etiqueta}</dt>
      <dd className="text-xl font-semibold tabular-nums">{valor}</dd>
    </div>
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
