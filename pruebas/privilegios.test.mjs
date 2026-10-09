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
  "20260826190000_procesar_carga_contrato.sql",
  "20260827100000_reporte_ordenado_datos.sql",
  "20260827100100_procesar_carga_v3.sql",
  "20260908100000_historial_mensual.sql",
  "20260914100000_totales_diarios.sql",
  "20260915100000_historial_mensual_por_producto.sql",
  "20260924210000_actualizar_ordenes_repetidas.sql",
  "20260924220000_ignorar_filas_desactualizadas.sql",
  "20260925100000_carga_ordenes_foto.sql",
  "20261009100000_latidos.sql",
];
let fallos = 0;
const ok = (c, t) => { if (!c) fallos++; console.log(`${c ? "  ok  " : "FALLA"} ${t}`); };

const db = await PGlite.create();
// `bypassrls` no es decorativo: así crea Supabase este rol, y es lo que hace
// que el servidor pueda escribir en tablas con RLS activado y sin policies
// (`latidos`, igual que `usuarios_autorizados` para lectura). Sin el atributo,
// esta prueba fallaba donde producción funciona — modelaba mal el rol.
await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
await db.exec("create schema auth; create table auth.users (id uuid primary key default gen_random_uuid(), email text);");
for (const m of M) await db.exec(readFileSync(RAIZ + "supabase/migrations/" + m, "utf8"));
console.log(`las ${M.length} migraciones aplicaron\n`);

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

console.log("\n=== la tabla de latidos del keep-alive ===");
// Esta sección existe porque el olvido de los GRANT ya dejó el keep-alive roto
// seis semanas en agosto. La tabla nueva no se estrena sin su prueba.
for (const pr of ["select", "insert", "update"])
  ok(await priv("service_role", "public.latidos", pr), `service_role ${pr.toUpperCase()} latidos`);
for (const rol of ["authenticated", "anon"])
  for (const pr of ["select", "insert", "update", "delete"])
    ok(!(await priv(rol, "public.latidos", pr)), `${rol} NO puede ${pr.toUpperCase()} latidos`);

console.log("\n=== el keep-alive del cron ahora sí puede correr ===");
await db.exec("set role service_role");
try {
  const r = await db.query("select count(*)::int c from public.productos");
  ok(true, `select count(*) from productos como service_role -> ${r.rows[0].c}`);
} catch (e) { ok(false, `keep-alive falla la lectura: ${e.message}`); }

// Y el latido, que es el paso nuevo del endpoint.
try {
  const upsert = `insert into public.latidos (id, ultimo_latido, origen)
                  values (1, $1, $2)
                  on conflict (id) do update
                    set ultimo_latido = excluded.ultimo_latido,
                        origen        = excluded.origen`;
  await db.query(upsert, ["2026-10-09T09:00:00Z", "vercel-cron/1.0"]);
  await db.query(upsert, ["2026-10-10T09:00:00Z", "vercel-cron/1.0"]);
  const f = await db.query("select count(*)::int c, max(ultimo_latido) m from public.latidos");
  ok(f.rows[0].c === 1, `dos corridas dejan UNA sola fila (son ${f.rows[0].c})`);
  ok(new Date(f.rows[0].m).toISOString() === "2026-10-10T09:00:00.000Z",
     "y la fila queda con la fecha de la última corrida");
} catch (e) { ok(false, `keep-alive falla el latido: ${e.message}`); }
await db.exec("reset role");

console.log(`\n${fallos === 0 ? "PRIVILEGIOS CORRECTOS" : `${fallos} FALLOS`}`);
process.exit(fallos ? 1 : 0);
