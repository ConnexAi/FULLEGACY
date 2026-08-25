import { NextResponse, type NextRequest } from "next/server";

import { esCorreoAutorizado } from "@/lib/config/env";
import { crearClienteProxy } from "@/lib/supabase/proxy";

/** Rutas accesibles sin sesión. Todo lo demás exige el correo autorizado. */
const RUTAS_PUBLICAS = ["/login", "/auth/callback", "/auth/sign-out"];

/**
 * Proxy (antes `middleware`) de Next.js.
 *
 * Refresca la sesión de Supabase en cada petición y bloquea todo lo que no
 * venga del correo autorizado.
 */
export async function proxy(request: NextRequest) {
  const { supabase, response } = crearClienteProxy(request);

  // getUser() valida el token contra Supabase y, de paso, lo refresca.
  // No usar getSession() aquí: no verifica la firma.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const esPublica = RUTAS_PUBLICAS.some(
    (ruta) => pathname === ruta || pathname.startsWith(`${ruta}/`),
  );

  if (esPublica) {
    return response;
  }

  if (!user) {
    const destino = request.nextUrl.clone();
    destino.pathname = "/login";
    destino.search = "";
    return NextResponse.redirect(destino);
  }

  // Cinturón y tirantes: si por lo que sea existe una sesión de otro correo,
  // se corta aquí también.
  if (!esCorreoAutorizado(user.email)) {
    await supabase.auth.signOut();
    const destino = request.nextUrl.clone();
    destino.pathname = "/login";
    destino.search = "?error=no_autorizado";
    return NextResponse.redirect(destino);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Todo excepto:
     *  - /api/cron/*        (se autentica con el header de Vercel Cron)
     *  - assets de Next.js y archivos estáticos
     */
    "/((?!api/cron|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
