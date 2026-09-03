import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ExcelJS es una librería de Node (usa streams y zlib). Se deja fuera del
  // bundle del servidor para que se cargue en tiempo de ejecución tal cual.
  serverExternalPackages: ["exceljs"],

  // El endpoint del Excel lee el logo del disco. En Vercel, `public/` no entra
  // solo al bundle de una función serverless: hay que declararlo.
  outputFileTracingIncludes: {
    "/api/cargas/*/excel": ["public/logo-fullegacy-marca.png"],
  },
};

export default nextConfig;
