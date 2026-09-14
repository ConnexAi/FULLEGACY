"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Barra de navegación entre las pantallas del sistema.
 *
 * Provisional a propósito: el rediseño visual es del Sprint 4. Acá solo
 * importa que Diego no tenga que escribir URLs.
 */
const ENLACES = [
  { href: "/", etiqueta: "Inicio" },
  { href: "/cargas", etiqueta: "Cargar archivo" },
  { href: "/reportes-ordenados", etiqueta: "Reportes ordenados" },
  { href: "/historial", etiqueta: "Historial mensual" },
  { href: "/dashboard", etiqueta: "Dashboard" },
] as const;

/** Rutas sin sesión: ahí la barra no va. */
const SIN_BARRA = ["/login", "/auth"];

export function Navegacion() {
  const ruta = usePathname();

  if (SIN_BARRA.some((base) => ruta === base || ruta.startsWith(`${base}/`))) {
    return null;
  }

  return (
    <header className="border-b border-black/10 dark:border-white/10">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-1 gap-y-2 px-6 py-3">
        <span className="mr-3 text-sm font-semibold tracking-tight text-[#3B6EA5]">
          FULLEGACY
        </span>

        <nav className="flex flex-wrap items-center gap-x-1 gap-y-1">
          {ENLACES.map((enlace) => (
            <Link
              key={enlace.href}
              href={enlace.href}
              aria-current={esActivo(ruta, enlace.href) ? "page" : undefined}
              className={`rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                esActivo(ruta, enlace.href)
                  ? "bg-black/[0.06] font-medium text-neutral-900 dark:bg-white/[0.10] dark:text-neutral-50"
                  : "text-neutral-600 hover:bg-black/[0.04] hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-white/[0.06] dark:hover:text-neutral-50"
              }`}
            >
              {enlace.etiqueta}
            </Link>
          ))}
        </nav>

        <form action="/auth/sign-out" method="post" className="ml-auto">
          <button
            type="submit"
            className="rounded-md px-2.5 py-1.5 text-sm text-neutral-500 transition-colors hover:bg-black/[0.04] hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-white/[0.06] dark:hover:text-neutral-50"
          >
            Cerrar sesión
          </button>
        </form>
      </div>
    </header>
  );
}

/** "/cargas" queda activo también dentro de "/cargas/12". */
function esActivo(ruta: string, href: string): boolean {
  if (href === "/") return ruta === "/";
  return ruta === href || ruta.startsWith(`${href}/`);
}
