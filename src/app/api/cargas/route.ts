import { NextResponse, type NextRequest } from "next/server";

import { esCorreoAutorizado } from "@/lib/auth/autorizacion";
import { ingerirArchivo } from "@/lib/dropi/ingesta";
import type { ResumenArchivo } from "@/lib/dropi/tipos";
import { crearClienteServidor } from "@/lib/supabase/server";

/** ExcelJS necesita APIs de Node; no corre en el runtime Edge. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Vercel corta los cuerpos de petición por encima de ~4.5 MB. */
const MAX_BYTES_POR_ARCHIVO = 4 * 1024 * 1024;
const MAX_ARCHIVOS = 10;

export async function POST(request: NextRequest) {
  // El proxy ya protege esta ruta, pero aquí se usa la service_role key
  // (salta RLS), así que la sesión se vuelve a verificar explícitamente.
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !(await esCorreoAutorizado(user.email))) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  let formulario: FormData;
  try {
    formulario = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "No se pudo leer el formulario. ¿El archivo es muy pesado?" },
      { status: 400 },
    );
  }

  const archivos = formulario
    .getAll("archivos")
    .filter((valor): valor is File => valor instanceof File && valor.size > 0);

  if (archivos.length === 0) {
    return NextResponse.json(
      { error: "No se recibió ningún archivo." },
      { status: 400 },
    );
  }

  if (archivos.length > MAX_ARCHIVOS) {
    return NextResponse.json(
      { error: `Máximo ${MAX_ARCHIVOS} archivos por carga.` },
      { status: 400 },
    );
  }

  const resumenes: ResumenArchivo[] = [];

  // Secuencial a propósito: cada archivo es su propia transacción y así los
  // duplicados entre dos archivos de la misma tanda se detectan bien
  // (el segundo ya ve las órdenes que insertó el primero).
  for (const archivo of archivos) {
    const rechazo = validar(archivo);
    if (rechazo) {
      resumenes.push(resumenRechazado(archivo.name, rechazo));
      continue;
    }

    resumenes.push(
      await ingerirArchivo(archivo.name, await archivo.arrayBuffer()),
    );
  }

  return NextResponse.json({ resumenes });
}

function validar(archivo: File): string | null {
  if (!archivo.name.toLowerCase().endsWith(".xlsx")) {
    return "Solo se aceptan archivos .xlsx. Si el archivo es .xls o .csv, ábrelo en Excel y guárdalo como .xlsx.";
  }
  if (archivo.size > MAX_BYTES_POR_ARCHIVO) {
    const mb = (archivo.size / 1024 / 1024).toFixed(1);
    return `El archivo pesa ${mb} MB y el límite es ${MAX_BYTES_POR_ARCHIVO / 1024 / 1024} MB.`;
  }
  return null;
}

function resumenRechazado(archivo: string, error: string): ResumenArchivo {
  return {
    archivo,
    ok: false,
    error,
    filasLeidas: 0,
    filasConError: 0,
    erroresMuestra: [],
    ordenesEnArchivo: 0,
    ordenesNuevas: 0,
    ordenesActualizadas: 0,
    ordenesSinCambios: 0,
    ordenesIncompletas: 0,
    lineasInsertadas: 0,
    productosNuevos: 0,
    variacionesNuevas: 0,
  };
}
