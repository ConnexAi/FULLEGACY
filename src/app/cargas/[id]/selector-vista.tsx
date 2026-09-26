import Link from "next/link";

import type { VistaReporte } from "@/lib/reportes/vista";

/**
 * Selector entre las dos lecturas del Reporte Ordenado.
 *
 * Son enlaces y no un control de cliente: el servidor ya decide qué datos
 * traer según el parámetro, y así funciona sin JavaScript y el enlace de cada
 * vista se puede compartir tal cual.
 */
export function SelectorVista({
  cargaId,
  vista,
}: {
  cargaId: number;
  vista: VistaReporte;
}) {
  return (
    <nav
      aria-label="Qué versión del reporte estás viendo"
      className="inline-flex rounded-lg border border-black/10 p-0.5 dark:border-white/15"
    >
      <Opcion
        href={`/cargas/${cargaId}`}
        activa={vista === "vivo"}
        titulo="En vivo"
      />
      <Opcion
        href={`/cargas/${cargaId}?vista=original`}
        activa={vista === "original"}
        titulo="Como se subió"
      />
    </nav>
  );
}

function Opcion({
  href,
  activa,
  titulo,
}: {
  href: string;
  activa: boolean;
  titulo: string;
}) {
  return (
    <Link
      href={href}
      aria-current={activa ? "page" : undefined}
      className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
        activa
          ? "bg-neutral-900 font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
          : "text-neutral-600 hover:bg-black/[0.04] dark:text-neutral-300 dark:hover:bg-white/[0.06]"
      }`}
    >
      {titulo}
    </Link>
  );
}

/**
 * Cartel que dice, sin lugar a dudas, qué se está mirando.
 *
 * Importa más de lo que parece: la misma orden puede figurar PENDIENTE en la
 * foto y despachada en vivo, así que confundir las dos vistas lleva a alistar
 * pedidos que ya salieron. Por eso la vista histórica además se tiñe de ámbar:
 * tiene que notarse de un vistazo, no solo leerse.
 */
export function AvisoDeVista({
  vista,
  subidoEn,
  tieneFoto,
}: {
  vista: VistaReporte;
  subidoEn: string;
  /** Si existe la foto del archivo. Ver `SinFoto` para el caso en que no. */
  tieneFoto: boolean;
}) {
  if (vista === "original") {
    return (
      <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200">
        <strong className="font-semibold">Foto del archivo, no el estado de hoy.</strong>{" "}
        Así venían estas órdenes cuando se subió el archivo, el {subidoEn}. Varias
        pueden haberse despachado desde entonces. Para alistar pedidos usá{" "}
        <em>En vivo</em>.
      </p>
    );
  }

  return (
    <p className="rounded-lg border border-black/10 px-4 py-3 text-sm text-neutral-600 dark:border-white/15 dark:text-neutral-300">
      <strong className="font-semibold text-neutral-800 dark:text-neutral-100">
        Estado de ahora.
      </strong>{" "}
      Lo que sigue pendiente de este archivo en este momento. Una orden que ya
      se despachó deja de aparecer acá.
      {tieneFoto ? null : <SinFoto />}
    </p>
  );
}

/**
 * Por qué esta carga no ofrece la vista histórica.
 *
 * Se dice en voz alta en lugar de esconder el selector y ya: si no, Diego ve
 * el selector en unas cargas y en otras no, y la explicación más a mano —
 * "se rompió" — es la equivocada.
 */
function SinFoto() {
  return (
    <>
      {" "}
      <span className="text-neutral-500 dark:text-neutral-400">
        Esta carga es anterior al registro histórico, así que no se guardó la
        foto de cómo venía el archivo: de esta solo existe esta vista.
      </span>
    </>
  );
}
