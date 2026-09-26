import { NextResponse, type NextRequest } from "next/server";

import { obtenerCargaConReporte } from "@/lib/reportes/consulta-carga";
import {
  generarExcelReporteOrdenado,
  nombreArchivoExcel,
} from "@/lib/reportes/excel-reporte-ordenado";
import { leerVista } from "@/lib/reportes/vista";

/** ExcelJS necesita APIs de Node. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Descarga del Reporte Ordenado de una carga en Excel.
 *
 * El proxy ya exige sesión para llegar acá, y la consulta usa el cliente con
 * la sesión de Diego, así que RLS aplica igual que en la pantalla.
 *
 * Acepta el mismo `?vista=original` que la pantalla para que el botón de
 * descarga baje exactamente lo que se está viendo y no la otra lectura.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const cargaId = Number(id);

  if (!Number.isInteger(cargaId) || cargaId <= 0) {
    return NextResponse.json({ error: "Carga inválida." }, { status: 400 });
  }

  const vistaPedida = leerVista(
    request.nextUrl.searchParams.get("vista") ?? undefined,
  );

  const datos = await obtenerCargaConReporte(cargaId, vistaPedida);
  if (!datos) {
    return NextResponse.json({ error: "Carga no encontrada." }, { status: 404 });
  }

  // La vista que devuelve la consulta, no la pedida: una carga sin foto cae a
  // la vista en vivo, y el archivo tiene que decir eso mismo.
  const { vista } = datos;
  const creadoEn = new Date(datos.carga.creado_en);
  const buffer = await generarExcelReporteOrdenado(datos.reporte, {
    nombreArchivo: datos.carga.nombre_archivo,
    creadoEn,
    vista,
  });

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nombreArchivoExcel(creadoEn, vista)}"`,
      "Cache-Control": "no-store",
    },
  });
}
