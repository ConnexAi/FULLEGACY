import Link from "next/link";
import { redirect } from "next/navigation";

import { GraficoMes } from "@/app/_inicio/grafico-mes";
import { obtenerResumenDelMes } from "@/lib/reportes/consulta-historial";
import { etiquetaDeMes } from "@/lib/reportes/historial-mensual";
import { diaDeHoyEnBogota, mesActualEnBogota } from "@/lib/reportes/meses";
import { crearClienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ACCESOS = [
  {
    href: "/cargas",
    titulo: "Cargar archivo",
    detalle: "Subir un Excel de Dropi",
  },
  {
    href: "/reportes-ordenados",
    titulo: "Reportes ordenados",
    detalle: "Listados para despachar",
  },
  {
    href: "/historial",
    titulo: "Historial mensual",
    detalle: "Excel por producto y día",
  },
  {
    href: "/dashboard",
    titulo: "Dashboard",
    detalle: "Pedidos y unidades por producto",
  },
] as const;

export default async function Inicio() {
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { anio, mes } = mesActualEnBogota();
  // La serie se corta hoy: los días que no llegaron caerían a cero y darían la
  // impresión de que el despacho se frenó.
  const resumen = await obtenerResumenDelMes(anio, mes, diaDeHoyEnBogota());

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-10 px-6 py-12">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">FULLEGACY</h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Sesión iniciada como {user.email}
        </p>
      </header>

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-lg font-semibold">
              Pedidos por día · {etiquetaDeMes(anio, mes)}
            </h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              Todos los productos juntos, en lo que va del mes.
            </p>
          </div>

          <div className="flex gap-6">
            <Cifra etiqueta="Pedidos" valor={resumen.totalPedidos} />
            <Cifra etiqueta="Unidades" valor={resumen.totalUnidades} />
          </div>
        </div>

        <GraficoMes dias={resumen.dias} etiquetaMes={etiquetaDeMes(anio, mes)} />

        {resumen.totalPedidos === 0 ? (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Este mes todavía no tiene despachos con guía generada.
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Ir a</h2>
        <nav className="grid gap-3 sm:grid-cols-2">
          {ACCESOS.map((acceso) => (
            <Link
              key={acceso.href}
              href={acceso.href}
              className="flex flex-col gap-0.5 rounded-lg border border-black/10 px-4 py-3 transition hover:bg-neutral-100 dark:border-white/15 dark:hover:bg-neutral-800"
            >
              <span className="text-sm font-medium">{acceso.titulo} →</span>
              <span className="text-xs text-neutral-500 dark:text-neutral-400">
                {acceso.detalle}
              </span>
            </Link>
          ))}
        </nav>
      </section>
    </main>
  );
}

function Cifra({ etiqueta, valor }: { etiqueta: string; valor: number }) {
  return (
    <div>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">{etiqueta}</p>
      <p className="text-2xl font-semibold tabular-nums">
        {valor.toLocaleString("es-CO")}
      </p>
    </div>
  );
}
