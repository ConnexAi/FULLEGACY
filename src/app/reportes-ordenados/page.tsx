import { ListaCargas } from "@/components/lista-cargas";

export const metadata = { title: "Reportes ordenados · FULLEGACY" };
export const dynamic = "force-dynamic";

/**
 * Listado de cargas para llegar a su Reporte Ordenado sin pasar por la
 * pantalla de subida.
 *
 * Los enlaces apuntan a `/cargas/[id]`, que ya sabe armar el reporte: una ruta
 * alias no aportaría nada y dejaría dos URLs para la misma pantalla.
 */
export default function PaginaReportesOrdenados() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Reportes ordenados
        </h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Un reporte por cada archivo cargado, con los pedidos de ese archivo
          por despachar. Abrí el que necesites para verlo o descargarlo en
          Excel.
        </p>
      </header>

      <ListaCargas />
    </main>
  );
}
