/**
 * Prueba el módulo real de autorización contra un PostgREST simulado.
 *
 * Se intercepta `fetch` (que es lo que usa supabase-js por dentro), así que
 * se ejercita el camino completo: crearClienteAdmin → supabase-js → HTTP →
 * parseo → cache. Sin tocar la base remota.
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://falso.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-falsa";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-falsa";

const { esCorreoAutorizado, invalidarCacheAutorizacion } = await import(
  "@/lib/auth/autorizacion"
);

let fallos = 0;
const ok = (c: boolean, t: string) => { if (!c) fallos++; console.log(`${c ? "  ok  " : "FALLA"} ${t}`); };

/* ── PostgREST simulado ────────────────────────────────────────────────── */
let tabla: string[] = [];
let consultas = 0;
let fallaLaBase = false;
let ultimaAutorizacion: string | null = null;

globalThis.fetch = (async (entrada: string | URL | Request, init?: RequestInit) => {
  const url = String(typeof entrada === "object" && "url" in entrada ? entrada.url : entrada);
  if (!url.includes("usuarios_autorizados")) throw new Error("URL inesperada: " + url);
  consultas += 1;
  ultimaAutorizacion = new Headers(init?.headers).get("apikey");
  if (fallaLaBase) {
    return new Response(JSON.stringify({ message: "permission denied" }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify(tabla.map((correo) => ({ correo }))), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}) as typeof fetch;

/* ── El bug reportado ──────────────────────────────────────────────────── */
console.log("── El escenario que fallaba: agregar un correo de prueba a la tabla ──");
tabla = ["diegoperea093@gmail.com", "correo.de.prueba@gmail.com"];
invalidarCacheAutorizacion();
ok(await esCorreoAutorizado("correo.de.prueba@gmail.com"),
   "un correo agregado a la tabla AHORA puede entrar");
ok(await esCorreoAutorizado("diegoperea093@gmail.com"),
   "el correo de Diego sigue entrando");

console.log("\n── Rechazo ──");
ok(!(await esCorreoAutorizado("intruso@gmail.com")), "un correo fuera de la tabla es rechazado");
ok(!(await esCorreoAutorizado(null)), "null es rechazado");
ok(!(await esCorreoAutorizado("")), "cadena vacía es rechazada");
ok(!(await esCorreoAutorizado("   ")), "solo espacios es rechazado");

console.log("\n── Normalización (Google puede devolver otras mayúsculas) ──");
invalidarCacheAutorizacion();
tabla = ["diegoperea093@gmail.com"];
ok(await esCorreoAutorizado("DiegoPerea093@Gmail.com"), "mayúsculas distintas → entra igual");
ok(await esCorreoAutorizado("  diegoperea093@gmail.com  "), "espacios alrededor → entra igual");

console.log("\n── Usa la service_role key (la tabla tiene RLS sin policy de lectura) ──");
ok(ultimaAutorizacion === "service-falsa", "la consulta va firmada con service_role");

console.log("\n── Cache ──");
invalidarCacheAutorizacion();
consultas = 0;
await esCorreoAutorizado("diegoperea093@gmail.com");
await esCorreoAutorizado("diegoperea093@gmail.com");
await esCorreoAutorizado("otro@gmail.com");
ok(consultas === 1, `3 verificaciones → 1 sola consulta a la base (fueron ${consultas})`);

console.log("\n── El login relee siempre (por eso el correo nuevo entra al instante) ──");
tabla = ["diegoperea093@gmail.com", "recien.agregado@gmail.com"];
ok(!(await esCorreoAutorizado("recien.agregado@gmail.com")),
   "con cache tibio todavía no lo ve");
ok(await esCorreoAutorizado("recien.agregado@gmail.com", { refrescar: true }),
   "con refrescar:true (lo que usa el callback) entra de inmediato");

console.log("\n── Revocar acceso ──");
tabla = ["diegoperea093@gmail.com"];
ok(!(await esCorreoAutorizado("recien.agregado@gmail.com", { refrescar: true })),
   "borrar la fila revoca el acceso");

console.log("\n── Falla cerrado ──");
fallaLaBase = true;
invalidarCacheAutorizacion();
ok(!(await esCorreoAutorizado("diegoperea093@gmail.com")),
   "si la base no responde, NO se deja entrar (fail closed)");
fallaLaBase = false;

console.log(`\n${fallos === 0 ? "AUTORIZACIÓN CORRECTA" : `${fallos} FALLOS`}`);
process.exit(fallos ? 1 : 0);
