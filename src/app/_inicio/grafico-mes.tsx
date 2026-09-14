"use client";

import { useRef, useState } from "react";

import type { PedidosDelDia } from "@/lib/reportes/historial-mensual";

/**
 * Vistazo del mes en curso: pedidos por día, sumados sobre todos los productos.
 *
 * Una sola serie a lo largo del tiempo, así que va como área con su línea y
 * sin caja de leyenda: el título ya dice qué se está mirando. El desglose por
 * producto vive en /dashboard.
 */

const ANCHO = 720;
const ALTO = 170;
const MARGEN = { arriba: 14, derecha: 14, abajo: 24, izquierda: 34 };
const AREA_ANCHO = ANCHO - MARGEN.izquierda - MARGEN.derecha;
const AREA_ALTO = ALTO - MARGEN.arriba - MARGEN.abajo;

export function GraficoMes({
  dias,
  etiquetaMes,
}: {
  dias: PedidosDelDia[];
  etiquetaMes: string;
}) {
  const [activo, setActivo] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  if (dias.length === 0) {
    return <SinDatos texto="El mes apenas comienza: todavía no hay días para graficar." />;
  }

  const maximo = Math.max(...dias.map((d) => d.pedidos), 1);
  const escalaX = (i: number) =>
    MARGEN.izquierda + (dias.length === 1 ? AREA_ANCHO / 2 : (i / (dias.length - 1)) * AREA_ANCHO);
  const escalaY = (v: number) => MARGEN.arriba + AREA_ALTO - (v / maximo) * AREA_ALTO;

  const puntos = dias.map((d, i) => ({ ...d, x: escalaX(i), y: escalaY(d.pedidos) }));
  const linea = puntos.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");
  const area =
    puntos.length > 1
      ? `${linea} L${puntos.at(-1)!.x} ${MARGEN.arriba + AREA_ALTO} L${puntos[0].x} ${MARGEN.arriba + AREA_ALTO} Z`
      : "";

  const ultimo = puntos.at(-1)!;
  const destacado = activo === null ? null : puntos[activo];

  // Tres marcas redondas en el eje: llevan los valores que no se etiquetan.
  const marcas = [0, Math.round(maximo / 2), maximo].filter(
    (v, i, todas) => todas.indexOf(v) === i,
  );

  function alMover(evento: React.PointerEvent<SVGSVGElement>) {
    const caja = svgRef.current?.getBoundingClientRect();
    if (!caja) return;

    const x = ((evento.clientX - caja.left) / caja.width) * ANCHO;
    const proporcion = (x - MARGEN.izquierda) / AREA_ANCHO;
    const indice = Math.round(proporcion * (dias.length - 1));
    setActivo(Math.min(Math.max(indice, 0), dias.length - 1));
  }

  return (
    <figure className="viz-root m-0 flex flex-col gap-2">
      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${ANCHO} ${ALTO}`}
          className="h-auto w-full touch-none"
          role="img"
          aria-label={`Pedidos por día en ${etiquetaMes}`}
          onPointerMove={alMover}
          onPointerLeave={() => setActivo(null)}
        >
          {/* Rejilla: fina, sólida y en un gris apenas separado del fondo. */}
          {marcas.map((valor) => (
            <g key={valor}>
              <line
                x1={MARGEN.izquierda}
                x2={ANCHO - MARGEN.derecha}
                y1={escalaY(valor)}
                y2={escalaY(valor)}
                className="stroke-black/10 dark:stroke-white/15"
                strokeWidth={1}
              />
              <text
                x={MARGEN.izquierda - 7}
                y={escalaY(valor) + 3.5}
                textAnchor="end"
                className="fill-neutral-400 text-[10px] tabular-nums dark:fill-neutral-500"
              >
                {valor}
              </text>
            </g>
          ))}

          {area ? <path d={area} fill="var(--viz-serie-1)" opacity={0.1} /> : null}
          {puntos.length > 1 ? (
            <path
              d={linea}
              fill="none"
              stroke="var(--viz-serie-1)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ) : null}

          {destacado ? (
            <line
              x1={destacado.x}
              x2={destacado.x}
              y1={MARGEN.arriba}
              y2={MARGEN.arriba + AREA_ALTO}
              className="stroke-black/20 dark:stroke-white/25"
              strokeWidth={1}
            />
          ) : null}

          {/* El punto activo y el del final llevan un anillo del color del
              fondo para seguir legibles sobre la línea. */}
          {[destacado ?? ultimo].map((punto) => (
            <circle
              key={punto.dia}
              cx={punto.x}
              cy={punto.y}
              r={4.5}
              fill="var(--viz-serie-1)"
              className="stroke-white dark:stroke-neutral-950"
              strokeWidth={2}
            />
          ))}

          <text
            x={MARGEN.izquierda}
            y={ALTO - 6}
            className="fill-neutral-400 text-[10px] tabular-nums dark:fill-neutral-500"
          >
            {dias[0].dia}
          </text>
          <text
            x={ANCHO - MARGEN.derecha}
            y={ALTO - 6}
            textAnchor="end"
            className="fill-neutral-400 text-[10px] tabular-nums dark:fill-neutral-500"
          >
            {ultimo.dia}
          </text>
        </svg>
      </div>

      <figcaption className="flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
        <span>
          {destacado
            ? `Día ${destacado.dia}: ${destacado.pedidos} pedidos · ${destacado.unidades} unidades`
            : `Del día ${dias[0].dia} al ${ultimo.dia} de ${etiquetaMes.toLowerCase()}`}
        </span>
        <span className="tabular-nums">
          {destacado ? "" : `Último día: ${ultimo.pedidos} pedidos`}
        </span>
      </figcaption>
    </figure>
  );
}

function SinDatos({ texto }: { texto: string }) {
  return (
    <p className="rounded-lg border border-black/10 px-4 py-3 text-sm text-neutral-600 dark:border-white/15 dark:text-neutral-300">
      {texto}
    </p>
  );
}
