import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ExcelJS es una librería de Node (usa streams y zlib). Se deja fuera del
  // bundle del servidor para que se cargue en tiempo de ejecución tal cual.
  serverExternalPackages: ["exceljs"],
};

export default nextConfig;
