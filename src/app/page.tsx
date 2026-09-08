import Link from "next/link";
import { redirect } from "next/navigation";

import { crearClienteServidor } from "@/lib/supabase/server";

/**
 * Página protegida por el middleware. Por ahora solo confirma que la sesión
 * funciona; el dashboard y los reportes llegan en sprints posteriores.
 */
export default async function Inicio() {
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 px-6 py-16">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">FULLEGACY</h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Sesión iniciada como {user.email}
        </p>
      </header>

      <nav className="flex flex-col gap-3">
        <Link
          href="/cargas"
          className="rounded-lg border border-black/10 px-4 py-3 text-sm font-medium transition hover:bg-neutral-100 dark:border-white/15 dark:hover:bg-neutral-800"
        >
          Cargar archivo de Dropi →
        </Link>
        <Link
          href="/historial"
          className="rounded-lg border border-black/10 px-4 py-3 text-sm font-medium transition hover:bg-neutral-100 dark:border-white/15 dark:hover:bg-neutral-800"
        >
          Historial mensual →
        </Link>
        <Link
          href="/dashboard"
          className="rounded-lg border border-black/10 px-4 py-3 text-sm font-medium transition hover:bg-neutral-100 dark:border-white/15 dark:hover:bg-neutral-800"
        >
          Dashboard →
        </Link>
      </nav>

      <p className="text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">
        El sistema calcula todo contra la base en el momento: lo que subas
        queda reflejado de inmediato en el historial y el dashboard.
      </p>

      <form action="/auth/sign-out" method="post">
        <button
          type="submit"
          className="rounded-lg border border-black/10 px-4 py-2 text-sm font-medium transition hover:bg-neutral-100 dark:border-white/15 dark:hover:bg-neutral-800"
        >
          Cerrar sesión
        </button>
      </form>
    </main>
  );
}
