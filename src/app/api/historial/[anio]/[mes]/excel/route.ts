import { NextResponse, type NextRequest } from "next/server";

import { obtenerHistorialMensual } from "@/lib/reportes/consulta-historial";
import {
  generarExcelHistorialMensual,
  nombreArchivoHistorial,
} from "@/lib/reportes/excel-historial-mensual";
import { esMesValido } from "@/lib/reportes/historial-mensual";

/** ExcelJS necesita APIs de Node. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Descarga del historial mensual.
 *
 * Se calcula contra la base en cada petición: no hay archivo guardado que
 * pueda quedar desactualizado, y un mes incompleto se descarga igual (los días
 * que no llegaron salen en cero).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ anio: string; mes: string }> },
) {
  const { anio: anioCrudo, mes: mesCrudo } = await params;
  const anio = Number(anioCrudo);
  const mes = Number(mesCrudo);

  if (!esMesValido(anio, mes)) {
    return NextResponse.json(
      { error: "Mes inválido. Se espera /api/historial/AAAA/MM/excel." },
      { status: 400 },
    );
  }

  const historial = await obtenerHistorialMensual(anio, mes);
  const buffer = await generarExcelHistorialMensual(historial);

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nombreArchivoHistorial(anio, mes)}"`,
      "Cache-Control": "no-store",
    },
  });
}
