import { NextResponse, type NextRequest } from "next/server";

import { esCorreoAutorizado } from "@/lib/auth/autorizacion";
import { crearClienteServidor } from "@/lib/supabase/server";

/**
 * Callback de Google OAuth.
 *
 * Aquí se cambia el `code` de PKCE por una sesión y se verifica que el correo
 * sea el autorizado. Si no lo es, la sesión se cierra de inmediato y se vuelve
 * al login con un error.
 *
 * Es la segunda línea de defensa: el trigger sobre `auth.users` ya impide que
 * se cree la cuenta (ver supabase/migrations/20260825120100_restriccion_acceso.sql).
 * Ambas capas leen la misma tabla `usuarios_autorizados`.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);

  // Supabase devuelve `error` cuando el proveedor o la base de datos rechazan
  // el alta — es el caso de un correo fuera de la lista blanca.
  if (searchParams.get("error")) {
    return NextResponse.redirect(`${origin}/login?error=no_autorizado`);
  }

  const code = searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=sin_codigo`);
  }

  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    return NextResponse.redirect(`${origin}/login?error=fallo_intercambio`);
  }

  // `refrescar` salta el cache: si acabas de agregar un correo a la tabla,
  // debe poder entrar de inmediato y no cuando venza el TTL.
  if (!(await esCorreoAutorizado(data.user.email, { refrescar: true }))) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=no_autorizado`);
  }

  return NextResponse.redirect(origin);
}
