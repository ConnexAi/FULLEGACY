"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useState } from "react";

/**
 * Pastilla flotante de navegación.
 *
 * Versión mínima y provisional: blanco y negro, sin marca. El rediseño visual
 * es del Sprint 4; acá solo importa que Diego se mueva entre pantallas y que
 * la barra no le coma espacio cuando no la necesita.
 */
const ENLACES = [
  { href: "/", etiqueta: "Inicio" },
  { href: "/cargas", etiqueta: "Cargar archivo" },
  { href: "/reportes-ordenados", etiqueta: "Reportes ordenados" },
  { href: "/historial", etiqueta: "Historial mensual" },
  { href: "/dashboard", etiqueta: "Dashboard" },
] as const;

/** Rutas sin sesión: ahí la pastilla no va. */
const SIN_BARRA = ["/login", "/auth"];

export function Navegacion() {
  const ruta = usePathname();
  const [abierta, setAbierta] = useState(true);
  const idPanel = useId();

  if (SIN_BARRA.some((base) => ruta === base || ruta.startsWith(`${base}/`))) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center px-4">
      <nav
        aria-label="Navegación principal"
        className="pointer-events-auto flex max-w-full items-center gap-1 rounded-full bg-neutral-900 p-1.5 text-white shadow-lg ring-1 ring-white/10 dark:bg-neutral-800"
      >
        <button
          type="button"
          onClick={() => setAbierta((valor) => !valor)}
          aria-expanded={abierta}
          aria-controls={idPanel}
          aria-label={abierta ? "Ocultar navegación" : "Mostrar navegación"}
          className="flex size-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
        >
          <IconoMenu abierta={abierta} />
        </button>

        {/*
          La animación va sobre una columna de grid de 0fr a 1fr: el ancho se
          interpola solo, sin tener que medir el contenido ni fijar un máximo.
        */}
        <div
          id={idPanel}
          inert={!abierta}
          className={`grid transition-all duration-300 ease-out ${
            abierta
              ? "grid-cols-[1fr] opacity-100"
              : "pointer-events-none grid-cols-[0fr] opacity-0"
          }`}
        >
          <div className="overflow-hidden">
            <ul className="flex items-center gap-0.5 overflow-x-auto whitespace-nowrap">
              {ENLACES.map((enlace) => {
                const activo = esActivo(ruta, enlace.href);
                return (
                  <li key={enlace.href}>
                    <Link
                      href={enlace.href}
                      aria-current={activo ? "page" : undefined}
                      className={`block rounded-full px-3.5 py-1.5 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none ${
                        activo
                          ? "bg-white/15 font-medium text-white"
                          : "text-white/70 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      {enlace.etiqueta}
                    </Link>
                  </li>
                );
              })}

              {/* Último elemento, con su propia pastilla clara: es una acción,
                  no un destino, y conviene que no se confunda con las pestañas. */}
              <li className="pl-1">
                <form action="/auth/sign-out" method="post">
                  <button
                    type="submit"
                    className="block rounded-full bg-white px-3.5 py-1.5 text-sm font-medium text-neutral-900 transition-colors hover:bg-white/85 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
                  >
                    Cerrar sesión
                  </button>
                </form>
              </li>
            </ul>
          </div>
        </div>
      </nav>
    </div>
  );
}

/** Hamburguesa que se convierte en X al abrir. */
function IconoMenu({ abierta }: { abierta: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
    >
      <line
        x1="2.5" y1="5" x2="13.5" y2="5"
        className="origin-center transition-transform duration-300 ease-out"
        style={abierta ? { transform: "translateY(3px) rotate(45deg)" } : undefined}
      />
      <line
        x1="2.5" y1="11" x2="13.5" y2="11"
        className="origin-center transition-transform duration-300 ease-out"
        style={abierta ? { transform: "translateY(-3px) rotate(-45deg)" } : undefined}
      />
    </svg>
  );
}

/** "/cargas" queda activo también dentro de "/cargas/12". */
function esActivo(ruta: string, href: string): boolean {
  if (href === "/") return ruta === "/";
  return ruta === href || ruta.startsWith(`${href}/`);
}
