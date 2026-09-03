import { NextResponse, type NextRequest } from "next/server";

import { obtenerCargaConReporte } from "@/lib/reportes/consulta-carga";
import {
  generarExcelReporteOrdenado,
  nombreArchivoExcel,
} from "@/lib/reportes/excel-reporte-ordenado";

/** ExcelJS necesita APIs de Node. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Descarga del Reporte Ordenado de una carga en Excel.
 *
 * El proxy ya exige sesión para llegar acá, y la consulta usa el cliente con
 * la sesión de Diego, así que RLS aplica igual que en la pantalla.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const cargaId = Number(id);

  if (!Number.isInteger(cargaId) || cargaId <= 0) {
    return NextResponse.json({ error: "Carga inválida." }, { status: 400 });
  }

  const datos = await obtenerCargaConReporte(cargaId);
  if (!datos) {
    return NextResponse.json({ error: "Carga no encontrada." }, { status: 404 });
  }

  const creadoEn = new Date(datos.carga.creado_en);
  const buffer = await generarExcelReporteOrdenado(datos.reporte, {
    nombreArchivo: datos.carga.nombre_archivo,
    creadoEn,
  });

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nombreArchivoExcel(creadoEn)}"`,
      "Cache-Control": "no-store",
    },
  });
}
