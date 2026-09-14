import Link from "next/link";

import { crearClienteServidor } from "@/lib/supabase/server";

/** Formato local para Diego: día/mes/año y hora, en zona colombiana. */
const FORMATO_FECHA = new Intl.DateTimeFormat("es-CO", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Bogota",
});

/**
 * Listado de cargas anteriores.
 *
 * La usan tanto /cargas (debajo del formulario) como /reportes-ordenados, que
 * es la forma de llegar a un reporte viejo sin pasar por la subida. Cada fila
 * enlaza a /cargas/[id], que es donde vive el Reporte Ordenado.
 *
 * Lee con la sesión de Diego (no con service_role): `cargas` tiene una policy
 * de lectura para `authenticated`.
 */
export async function ListaCargas() {
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase
    .from("cargas")
    .select(
      "id, nombre_archivo, creado_en, ordenes_nuevas, ordenes_omitidas, filas_con_error",
    )
    .order("creado_en", { ascending: false })
    .limit(50);

  if (error) {
    return (
      <p className="text-sm text-red-600 dark:text-red-400">
        No se pudo leer el historial de cargas: {error.message}
      </p>
    );
  }

  if (!data || data.length === 0) {
    return (
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        Todavía no has subido ningún archivo.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-lg border-collapse text-sm">
        <thead>
          <tr className="border-b border-black/10 text-left dark:border-white/15">
            <th className="py-2 pr-4 font-medium">Archivo</th>
            <th className="py-2 pr-4 font-medium">Fecha</th>
            <th className="py-2 pr-4 text-right font-medium">Nuevas</th>
            <th className="py-2 pr-4 text-right font-medium">Omitidas</th>
            <th className="py-2 text-right font-medium">Con error</th>
          </tr>
        </thead>
        <tbody>
          {data.map((carga) => (
            <tr
              key={carga.id}
              className="border-b border-black/5 last:border-0 dark:border-white/10"
            >
              <td className="py-2 pr-4">
                <Link
                  href={`/cargas/${carga.id}`}
                  className="font-mono break-all underline underline-offset-2 hover:no-underline"
                >
                  {carga.nombre_archivo}
                </Link>
              </td>
              <td className="py-2 pr-4 whitespace-nowrap text-neutral-500 dark:text-neutral-400">
                {FORMATO_FECHA.format(new Date(carga.creado_en))}
              </td>
              <td className="py-2 pr-4 text-right tabular-nums">
                {carga.ordenes_nuevas}
              </td>
              <td className="py-2 pr-4 text-right tabular-nums text-neutral-500 dark:text-neutral-400">
                {carga.ordenes_omitidas}
              </td>
              <td
                className={`py-2 text-right tabular-nums ${
                  carga.filas_con_error > 0
                    ? "text-amber-700 dark:text-amber-400"
                    : "text-neutral-500 dark:text-neutral-400"
                }`}
              >
                {carga.filas_con_error}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
