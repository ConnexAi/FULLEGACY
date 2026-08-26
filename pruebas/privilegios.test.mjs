/** Verifica la migración de privilegios sobre un Postgres real (WASM). */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const RAIZ = new URL("..", import.meta.url).pathname;
const M = [
  "20260825120000_esquema_inicial.sql",
  "20260825120100_restriccion_acceso.sql",
  "20260826090000_ordenes_numero_guia.sql",
  "20260826090100_procesar_carga.sql",
  "20260826150000_privilegios_tablas.sql",
  "20260826170000_linea_producto_directo.sql",
  "20260826170100_historial_cargas.sql",
  "20260826170200_procesar_carga_v2.sql",
];
let fallos = 0;
const ok = (c, t) => { if (!c) fallos++; console.log(`${c ? "  ok  " : "FALLA"} ${t}`); };

const db = await PGlite.create();
await db.exec("create role anon; create role authenticated; create role service_role;");
await db.exec("create schema auth; create table auth.users (id uuid primary key default gen_random_uuid(), email text);");
for (const m of M) await db.exec(readFileSync(RAIZ + "supabase/migrations/" + m, "utf8"));
console.log("las 8 migraciones aplicaron\n");

const priv = async (rol, tabla, p) =>
  (await db.query(`select has_table_privilege($1,$2,$3) v`, [rol, tabla, p])).rows[0].v;

console.log("=== service_role sobre las tablas de datos ===");
for (const t of ["productos", "producto_variaciones", "ordenes", "orden_productos"]) {
  ok(await priv("service_role", `public.${t}`, "select"), `service_role SELECT ${t}`);
  ok(await priv("service_role", `public.${t}`, "insert"), `service_role INSERT ${t}`);
}

console.log("\n=== authenticated solo lee ===");
for (const t of ["productos", "ordenes"]) {
  ok(await priv("authenticated", `public.${t}`, "select"), `authenticated SELECT ${t}`);
  ok(!(await priv("authenticated", `public.${t}`, "insert")), `authenticated NO puede INSERT ${t}`);
}

console.log("\n=== la lista blanca es solo del servidor ===");
ok(await priv("service_role", "public.usuarios_autorizados", "select"), "service_role SÍ lee usuarios_autorizados");
ok(!(await priv("authenticated", "public.usuarios_autorizados", "select")), "authenticated NO lee usuarios_autorizados");
ok(!(await priv("anon", "public.usuarios_autorizados", "select")), "anon NO lee usuarios_autorizados");
ok(!(await priv("service_role", "public.usuarios_autorizados", "insert")), "service_role NO puede escribirla");

console.log("\n=== historial de cargas ===");
ok(await priv("authenticated", "public.cargas", "select"), "authenticated SÍ lee cargas (lo muestra /cargas)");
ok(!(await priv("authenticated", "public.cargas", "insert")), "authenticated NO puede escribir cargas");
ok(await priv("service_role", "public.cargas", "insert"), "service_role SÍ puede registrarlas");
ok(!(await priv("anon", "public.cargas", "select")), "anon NO lee cargas");

console.log("\n=== anon sigue sin acceso a los datos ===");
for (const t of ["productos", "ordenes"]) ok(!(await priv("anon", `public.${t}`, "select")), `anon NO lee ${t}`);

console.log("\n=== el keep-alive del cron ahora sí puede correr ===");
await db.exec("set role service_role");
try {
  const r = await db.query("select count(*)::int c from public.productos");
  ok(true, `select count(*) from productos como service_role -> ${r.rows[0].c}`);
} catch (e) { ok(false, `keep-alive falla: ${e.message}`); }
await db.exec("reset role");

console.log(`\n${fallos === 0 ? "PRIVILEGIOS CORRECTOS" : `${fallos} FALLOS`}`);
process.exit(fallos ? 1 : 0);
