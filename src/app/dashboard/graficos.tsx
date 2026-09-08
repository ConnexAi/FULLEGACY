"use client";

import { useId, useState } from "react";

import {
  agruparSectores,
  type Sector,
} from "@/lib/reportes/paleta-graficos";
import type { TotalProducto } from "@/lib/reportes/consulta-historial";

/* -------------------------------------------------------------------------- */
/* Torta: participación de unidades por producto                              */
/* -------------------------------------------------------------------------- */

const RADIO = 68;
const GROSOR = 24;
const CIRCUNFERENCIA = 2 * Math.PI * RADIO;
/** Separación en la superficie entre sectores, en px de trazo. */
const SEPARACION = 2;

export function TortaUnidades({ datos }: { datos: TotalProducto[] }) {
  const [activo, setActivo] = useState<number | null>(null);

  const sectores = agruparSectores(
    datos.map((d) => ({ etiqueta: d.producto, valor: d.unidades })),
  );
  const total = sectores.reduce((n, s) => n + s.valor, 0);

  if (total === 0) return <SinDatos />;

  const arcos = calcularArcos(sectores, total);

  const resaltado = activo === null ? null : sectores[activo];

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-8">
      <div className="relative shrink-0">
        <svg
          viewBox="0 0 180 180"
          className="h-44 w-44"
          role="img"
          aria-label="Participación de unidades por producto"
        >
          {arcos.map(({ sector, largo, desfase }, i) => (
            <circle
              key={sector.etiqueta}
              cx="90"
              cy="90"
              r={RADIO}
              fill="none"
              stroke={colorSector(sector)}
              strokeWidth={activo === i ? GROSOR + 4 : GROSOR}
              strokeDasharray={`${largo} ${CIRCUNFERENCIA - largo}`}
              strokeDashoffset={-desfase}
              transform="rotate(-90 90 90)"
              className="cursor-default transition-[stroke-width] duration-150"
              onMouseEnter={() => setActivo(i)}
              onMouseLeave={() => setActivo(null)}
            />
          ))}
        </svg>

        {/* El centro del donut lleva el dato, no una etiqueta decorativa. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-50">
            {(resaltado?.valor ?? total).toLocaleString("es-CO")}
          </span>
          <span className="max-w-24 text-center text-[11px] leading-tight text-neutral-500 dark:text-neutral-400">
            {resaltado ? resaltado.etiqueta : "unidades"}
          </span>
        </div>
      </div>

      {/* Con dos o más series la leyenda va siempre: la identidad nunca
          depende solo del color. */}
      <ul className="flex min-w-0 flex-1 flex-col gap-1.5">
        {sectores.map((sector, i) => (
          <li
            key={sector.etiqueta}
            onMouseEnter={() => setActivo(i)}
            onMouseLeave={() => setActivo(null)}
            className={`flex items-center gap-2 rounded px-1 py-0.5 text-sm transition-colors ${
              activo === i ? "bg-black/[0.04] dark:bg-white/[0.06]" : ""
            }`}
          >
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: colorSector(sector) }}
            />
            <span className="min-w-0 flex-1 truncate text-neutral-700 dark:text-neutral-200">
              {sector.etiqueta}
            </span>
            <span className="shrink-0 tabular-nums text-neutral-500 dark:text-neutral-400">
              {Math.round((sector.valor / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface Arco {
  sector: Sector;
  largo: number;
  desfase: number;
}

/**
 * Convierte los sectores en arcos consecutivos del donut.
 *
 * Cada arco se acorta 2px para dejar una separación en el color de la
 * superficie: es esa rendija —no un borde dibujado— la que separa un sector
 * del siguiente.
 */
function calcularArcos(sectores: Sector[], total: number): Arco[] {
  const arcos: Arco[] = [];
  let desfase = 0;

  for (const sector of sectores) {
    const fraccion = sector.valor / total;
    arcos.push({
      sector,
      largo: Math.max(0, fraccion * CIRCUNFERENCIA - SEPARACION),
      desfase,
    });
    desfase += fraccion * CIRCUNFERENCIA;
  }

  return arcos;
}

/** El color sale de una variable CSS, que es la que cambia en modo oscuro. */
function colorSector(sector: Sector): string {
  return sector.indiceColor < 0
    ? "var(--viz-otros)"
    : `var(--viz-sector-${sector.indiceColor + 1})`;
}

/* -------------------------------------------------------------------------- */
/* Barras: pedidos y unidades por producto                                    */
/* -------------------------------------------------------------------------- */

export function BarrasPorProducto({ datos }: { datos: TotalProducto[] }) {
  const [activo, setActivo] = useState<string | null>(null);
  const idLeyenda = useId();

  if (datos.length === 0) return <SinDatos />;

  const maximo = Math.max(...datos.flatMap((d) => [d.pedidos, d.unidades]), 1);
  // Solo la serie principal lleva etiqueta directa; la otra vive en el tooltip
  // y en la tabla. Un número en cada marca se vuelve ruido.
  const conEtiqueta = datos[0]?.producto;

  return (
    <div className="flex flex-col gap-4">
      <ul
        id={idLeyenda}
        className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm"
      >
        {(
          [
            ["Pedidos", "var(--viz-serie-1)"],
            ["Unidades", "var(--viz-serie-2)"],
          ] as const
        ).map(([etiqueta, color]) => (
          <li key={etiqueta} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="size-2.5 rounded-sm"
              style={{ backgroundColor: color }}
            />
            <span className="text-neutral-600 dark:text-neutral-300">
              {etiqueta}
            </span>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-3">
        {datos.map((fila) => (
          <div
            key={fila.producto}
            onMouseEnter={() => setActivo(fila.producto)}
            onMouseLeave={() => setActivo(null)}
            className={`grid grid-cols-[minmax(0,11rem)_1fr] items-center gap-x-3 rounded px-1 py-0.5 transition-colors sm:grid-cols-[minmax(0,15rem)_1fr] ${
              activo === fila.producto ? "bg-black/[0.04] dark:bg-white/[0.06]" : ""
            }`}
          >
            <span
              className="truncate text-sm text-neutral-700 dark:text-neutral-200"
              title={fila.producto}
            >
              {fila.producto}
            </span>

            <div className="flex flex-col gap-[2px]">
              <Barra
                valor={fila.pedidos}
                maximo={maximo}
                color="var(--viz-serie-1)"
                etiqueta={
                  fila.producto === conEtiqueta || activo === fila.producto
                    ? `${fila.pedidos} pedidos`
                    : null
                }
              />
              <Barra
                valor={fila.unidades}
                maximo={maximo}
                color="var(--viz-serie-2)"
                etiqueta={
                  fila.producto === conEtiqueta || activo === fila.producto
                    ? `${fila.unidades} unidades`
                    : null
                }
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Una barra: fina, con la punta redondeada y la base cuadrada, creciendo desde
 * una línea base común.
 */
function Barra({
  valor,
  maximo,
  color,
  etiqueta,
}: {
  valor: number;
  maximo: number;
  color: string;
  etiqueta: string | null;
}) {
  const porcentaje = maximo === 0 ? 0 : (valor / maximo) * 100;

  return (
    <div className="flex items-center gap-2">
      <div className="h-2.5 min-w-0 flex-1">
        <div
          className="h-full rounded-r-[4px]"
          style={{ width: `${Math.max(porcentaje, valor > 0 ? 1.5 : 0)}%`, backgroundColor: color }}
        />
      </div>
      <span
        className={`w-28 shrink-0 text-xs tabular-nums text-neutral-500 transition-opacity dark:text-neutral-400 ${
          etiqueta ? "opacity-100" : "opacity-0"
        }`}
      >
        {etiqueta ?? ""}
      </span>
    </div>
  );
}

function SinDatos() {
  return (
    <p className="text-sm text-neutral-500 dark:text-neutral-400">
      No hay despachos registrados en este mes.
    </p>
  );
}
