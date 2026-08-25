import { redirect } from "next/navigation";

import { BotonGoogle } from "@/app/login/boton-google";
import { esCorreoAutorizado } from "@/lib/config/env";
import { crearClienteServidor } from "@/lib/supabase/server";

export const metadata = {
  title: "Ingresar · FULLEGACY",
};

/** Mensajes de error que el callback puede devolver por querystring. */
const MENSAJES: Record<string, string> = {
  no_autorizado:
    "Esa cuenta de Google no tiene acceso a este sistema. Ingresa con el correo autorizado.",
  fallo_intercambio:
    "No se pudo completar el inicio de sesión. Vuelve a intentarlo.",
  sin_codigo: "El enlace de inicio de sesión no es válido o ya expiró.",
};

export default async function PaginaLogin({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Ya hay una sesión válida: no tiene sentido mostrar el login.
  if (user && esCorreoAutorizado(user.email)) {
    redirect("/");
  }

  const { error } = await searchParams;
  const mensaje = error ? (MENSAJES[error] ?? MENSAJES.fallo_intercambio) : null;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-50 px-6 dark:bg-neutral-950">
      <div className="w-full max-w-sm rounded-2xl border border-black/5 bg-white p-8 shadow-sm dark:border-white/10 dark:bg-neutral-900">
        <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
          FULLEGACY
        </h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Reportes de pedidos
        </p>

        {mensaje ? (
          <p
            role="alert"
            className="mt-6 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
          >
            {mensaje}
          </p>
        ) : null}

        <div className="mt-6">
          <BotonGoogle />
        </div>

        <p className="mt-6 text-xs leading-relaxed text-neutral-400 dark:text-neutral-500">
          Acceso restringido. Este sistema no admite registro público.
        </p>
      </div>
    </main>
  );
}
