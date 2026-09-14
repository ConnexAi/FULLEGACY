import Link from "next/link";

import { FormularioCarga } from "@/app/cargas/formulario-carga";
import { ListaCargas } from "@/components/lista-cargas";

export const metadata = {
  title: "Cargar archivo · FULLEGACY",
};

// El historial cambia con cada subida: no debe servirse cacheado.
export const dynamic = "force-dynamic";

export default function PaginaCargas() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 py-12">
      <header className="flex flex-col gap-1">
        <Link
          href="/"
          className="text-sm text-neutral-500 hover:underline dark:text-neutral-400"
        >
          ← Inicio
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          Cargar archivo de Dropi
        </h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Sube el Excel exportado de Dropi. Se registran las órdenes nuevas y se
          arma solo el catálogo de productos y variaciones.
        </p>
      </header>

      <FormularioCarga />

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Cargas anteriores</h2>
        <ListaCargas />
      </section>
    </main>
  );
}
