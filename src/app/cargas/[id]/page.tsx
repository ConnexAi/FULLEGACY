import Link from "next/link";
import { notFound } from "next/navigation";

import { crearClienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const FORMATO_FECHA = new Intl.DateTimeFormat("es-CO", {
  dateStyle: "full",
  timeStyle: "short",
  timeZone: "America/Bogota",
});

/**
 * Detalle de una carga.
 *
 * Por ahora solo muestra el resumen guardado. El Reporte Ordenado de esta
 * carga se construye en el Sprint 2: es justamente para eso que `ordenes`
 * quedó ligada a `cargas`.
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
  const { data: carga, error } = await supabase
    .from("cargas")
    .select("*")
    .eq("id", cargaId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!carga) notFound();

  const datos: [string, number][] = [
    ["Órdenes nuevas", carga.ordenes_nuevas],
    ["Omitidas (duplicadas)", carga.ordenes_omitidas],
    ["Filas leídas", carga.filas_leidas],
    ["Filas con error", carga.filas_con_error],
    ["Productos nuevos", carga.productos_nuevos],
    ["Variaciones nuevas", carga.variaciones_nuevas],
  ];

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-12">
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
          {FORMATO_FECHA.format(new Date(carga.creado_en))}
        </p>
      </header>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
        {datos.map(([etiqueta, valor]) => (
          <div key={etiqueta}>
            <dt className="text-xs text-neutral-500 dark:text-neutral-400">
              {etiqueta}
            </dt>
            <dd className="text-lg font-semibold tabular-nums">{valor}</dd>
          </div>
        ))}
      </dl>

      <p className="rounded-lg border border-black/10 px-4 py-3 text-sm text-neutral-600 dark:border-white/15 dark:text-neutral-300">
        El Reporte Ordenado de esta carga se construye en el Sprint 2.
      </p>
    </main>
  );
}
