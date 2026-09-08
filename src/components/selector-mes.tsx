"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

import type { OpcionMes } from "@/lib/reportes/meses";

/**
 * Selector de mes. Escribe el mes en la URL para que la página (server
 * component) recalcule el resumen contra la base.
 */
export function SelectorMes({
  opciones,
  seleccionado,
}: {
  opciones: OpcionMes[];
  seleccionado: string;
}) {
  const router = useRouter();
  const parametros = useSearchParams();
  const [pendiente, iniciarTransicion] = useTransition();
  const [valor, setValor] = useState(seleccionado);

  function cambiar(nuevo: string) {
    setValor(nuevo);
    const siguientes = new URLSearchParams(parametros.toString());
    siguientes.set("mes", nuevo);
    iniciarTransicion(() => router.push(`?${siguientes.toString()}`));
  }

  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">Mes</span>
      <select
        value={valor}
        disabled={pendiente}
        onChange={(evento) => cambiar(evento.target.value)}
        className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm disabled:opacity-60 dark:border-white/20 dark:bg-neutral-900"
      >
        {opciones.map((opcion) => (
          <option key={opcion.valor} value={opcion.valor}>
            {opcion.etiqueta}
          </option>
        ))}
      </select>
    </label>
  );
}
