"use client";

import { useRef, useState } from "react";

import type { ResumenArchivo } from "@/lib/dropi/tipos";

type Estado =
  | { fase: "inicial" }
  | { fase: "procesando" }
  | { fase: "listo"; resumenes: ResumenArchivo[] }
  | { fase: "error"; mensaje: string };

export function FormularioCarga() {
  const [estado, setEstado] = useState<Estado>({ fase: "inicial" });
  const inputRef = useRef<HTMLInputElement>(null);

  async function enviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const formulario = new FormData(evento.currentTarget);

    setEstado({ fase: "procesando" });

    try {
      const respuesta = await fetch("/api/cargas", {
        method: "POST",
        body: formulario,
      });

      const cuerpo = await respuesta.json();

      if (!respuesta.ok) {
        setEstado({
          fase: "error",
          mensaje: cuerpo?.error ?? "No se pudo procesar la carga.",
        });
        return;
      }

      setEstado({ fase: "listo", resumenes: cuerpo.resumenes ?? [] });
      inputRef.current!.value = "";
    } catch {
      setEstado({
        fase: "error",
        mensaje:
          "Se perdió la conexión durante la carga. Vuelve a intentarlo; las órdenes ya guardadas no se duplican.",
      });
    }
  }

  const procesando = estado.fase === "procesando";

  return (
    <div className="flex flex-col gap-8">
      <form onSubmit={enviar} className="flex flex-col items-start gap-4">
        <label className="flex w-full flex-col gap-2">
          <span className="text-sm font-medium">Archivos de Dropi (.xlsx)</span>
          <input
            ref={inputRef}
            type="file"
            name="archivos"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            multiple
            required
            disabled={procesando}
            className="block w-full text-sm file:mr-4 file:rounded-md file:border-0 file:bg-neutral-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white disabled:opacity-50 dark:file:bg-neutral-100 dark:file:text-neutral-900"
          />
        </label>

        <button
          type="submit"
          disabled={procesando}
          className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          {procesando ? "Procesando…" : "Subir y procesar"}
        </button>

        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          Puedes subir el mismo archivo dos veces sin problema: las órdenes que
          ya existan se omiten automáticamente.
        </p>
      </form>

      {estado.fase === "error" ? (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
        >
          {estado.mensaje}
        </p>
      ) : null}

      {estado.fase === "listo" ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">Resultado</h2>
          {estado.resumenes.map((resumen, indice) => (
            <TarjetaResumen key={`${resumen.archivo}-${indice}`} resumen={resumen} />
          ))}
        </section>
      ) : null}
    </div>
  );
}

function TarjetaResumen({ resumen }: { resumen: ResumenArchivo }) {
  const erroresOcultos = resumen.filasConError - resumen.erroresMuestra.length;

  return (
    <article
      className={`rounded-lg border p-4 ${
        resumen.ok
          ? "border-black/10 dark:border-white/15"
          : "border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/30"
      }`}
    >
      <h3 className="font-mono text-sm font-medium break-all">
        {resumen.archivo}
      </h3>

      {resumen.error ? (
        <p className="mt-2 text-sm text-red-700 dark:text-red-300">
          {resumen.error}
        </p>
      ) : null}

      {resumen.ok ? (
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <Dato etiqueta="Órdenes nuevas" valor={resumen.ordenesNuevas} destacar />
          <Dato etiqueta="Omitidas (duplicadas)" valor={resumen.ordenesOmitidas} />
          <Dato etiqueta="Órdenes en el archivo" valor={resumen.ordenesEnArchivo} />
          <Dato etiqueta="Filas leídas" valor={resumen.filasLeidas} />
          <Dato etiqueta="Líneas guardadas" valor={resumen.lineasInsertadas} />
          <Dato etiqueta="Filas con error" valor={resumen.filasConError} />
          <Dato etiqueta="Productos nuevos" valor={resumen.productosNuevos} />
          <Dato etiqueta="Variaciones nuevas" valor={resumen.variacionesNuevas} />
        </dl>
      ) : null}

      {resumen.ordenesIncompletas > 0 ? (
        <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200">
          {resumen.ordenesIncompletas}{" "}
          {resumen.ordenesIncompletas === 1
            ? "orden se guardó pero le faltó al menos una línea"
            : "órdenes se guardaron pero les faltó al menos una línea"}{" "}
          porque esa fila del archivo venía con error. Revisa el detalle.
        </p>
      ) : null}

      {resumen.erroresMuestra.length > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium">
            Ver filas con error ({resumen.filasConError})
          </summary>
          <ul className="mt-2 flex flex-col gap-1 text-sm text-neutral-600 dark:text-neutral-300">
            {resumen.erroresMuestra.map((error) => (
              <li key={error.fila}>
                <span className="font-mono">Fila {error.fila}</span>
                {error.idOrden !== null ? (
                  <span className="font-mono"> (orden {error.idOrden})</span>
                ) : null}
                : {error.motivo}
              </li>
            ))}
          </ul>
          {erroresOcultos > 0 ? (
            <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
              … y {erroresOcultos} más.
            </p>
          ) : null}
        </details>
      ) : null}
    </article>
  );
}

function Dato({
  etiqueta,
  valor,
  destacar = false,
}: {
  etiqueta: string;
  valor: number;
  destacar?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-neutral-500 dark:text-neutral-400">
        {etiqueta}
      </dt>
      <dd
        className={
          destacar ? "text-lg font-semibold tabular-nums" : "tabular-nums"
        }
      >
        {valor}
      </dd>
    </div>
  );
}
