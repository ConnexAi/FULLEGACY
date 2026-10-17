/**
 * La foto de cada carga: qué traía el archivo tal como se subió.
 *
 * El Reporte Ordenado en vivo sigue a la orden: cuando un archivo posterior la
 * actualiza, `ordenes.carga_id` se muda y el reporte de la carga vieja se
 * vacía solo. Eso es correcto para alistar pedidos, y no cambia acá.
 *
 * Lo que agrega `carga_ordenes_foto` es la otra pregunta: qué decía el archivo
 * del martes, el martes. Se prueban las dos cosas a la vez, porque el riesgo
 * real no es que la foto salga mal sino que al agregarla se mueva la vista en
 * vivo, que es la que Diego usa todos los días.
 *
 * Contra Postgres real, con las migraciones del repo.
 */
import { readFileSync } from "node:fs";

import { PGlite } from "@electric-sql/pglite";

import {
  construirReporteOrdenado,
  type LineaCarga,
} from "@/lib/reportes/reporte-ordenado";

const RAIZ = new URL("..", import.meta.url).pathname;
const MIGRACIONES = [
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
  "20261017100000_historial_mensual_ordenes.sql",
];

process.on("uncaughtException", (e) => {
  console.error("\nERROR:", (e as Error).message);
  process.exit(1);
});

let fallos = 0;
function check(nombre: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos += 1;
  console.log(
    `${ok ? "  ok  " : "FALLA"} ${nombre}` +
      (ok
        ? ""
        : `\n        esperado: ${JSON.stringify(esperado)}\n        real:     ${JSON.stringify(real)}`),
  );
}

const db = await PGlite.create();
await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
`);
for (const archivo of MIGRACIONES) {
  await db.exec(readFileSync(`${RAIZ}supabase/migrations/${archivo}`, "utf8"));
}

interface Resultado {
  carga_id: number;
  ordenes_nuevas: number;
  ordenes_actualizadas: number;
  ordenes_sin_cambios: number;
  ids_desactualizados: number[];
  filas_foto: number;
}

interface OrdenEntrada {
  id_orden: number;
  estado: string;
  fecha_orden: string;
  fecha_guia_generada: string | null;
  numero_guia: string | null;
  transportadora?: string | null;
  ciudad_destino?: string | null;
  lineas: { producto_id: number; variacion_id: null; cantidad: number; linea: number }[];
}

const PRODUCTOS = [
  { id: 1, nombre: "Hydra", sku: "SKU-H" },
  { id: 2, nombre: "Waggy pet", sku: "SKU-W" },
];

const procesar = async (nombre: string, ordenes: OrdenEntrada[]): Promise<Resultado> =>
  (await db.query<{ r: Resultado }>("select public.procesar_carga($1::jsonb) as r", [
    JSON.stringify({
      archivo: { nombre, filas_leidas: ordenes.length, filas_con_error: 0 },
      productos: PRODUCTOS,
      variaciones: [],
      ordenes,
    }),
  ])).rows[0].r;

const linea = (producto: number, cantidad = 1) => ({
  producto_id: producto, variacion_id: null as null, cantidad, linea: 1,
});

/** La foto de una carga, ordenada y normalizada para comparar de una. */
const fotoDe = async (cargaId: number) =>
  (await db.query<{
    id_orden: string; estado: string; numero_guia: string | null;
    fecha_guia_generada: string | null; transportadora: string | null;
    ciudad_destino: string | null; tipo: string;
  }>(
    `select id_orden, estado, numero_guia, fecha_guia_generada,
            transportadora, ciudad_destino, tipo
       from carga_ordenes_foto where carga_id = $1 order by id_orden`,
    [cargaId],
  )).rows.map((f) => ({
    id_orden: Number(f.id_orden),
    estado: f.estado,
    numero_guia: f.numero_guia,
    tiene_fecha_guia: f.fecha_guia_generada !== null,
    transportadora: f.transportadora,
    ciudad_destino: f.ciudad_destino,
    tipo: f.tipo,
  }));

/**
 * El Reporte Ordenado de una carga desde cualquiera de las dos vistas.
 *
 * Es la misma consulta que hace `obtenerCargaConReporte()`: mismo filtro de
 * estado, mismo `construirReporteOrdenado()`. Solo cambia el origen, que es
 * justamente lo que se quiere probar.
 */
const reporteDe = async (cargaId: number, vista: "vivo" | "original") => {
  const origen = vista === "original" ? "v_lineas_carga_foto" : "v_lineas_carga";
  const lineas = (await db.query<LineaCarga>(
    `select carga_id, id_orden, estado, estado_normalizado, numero_guia,
            transportadora, ciudad_destino, linea, producto_id, producto_nombre,
            variacion_id, texto_variacion, unidades_extraidas, cantidad::int as cantidad
       from ${origen}
      where carga_id = $1 and estado_normalizado like 'PENDIENTE%'`,
    [cargaId],
  )).rows.map((l) => ({
    ...l,
    id_orden: Number(l.id_orden),
    producto_id: Number(l.producto_id),
    variacion_id: l.variacion_id === null ? null : Number(l.variacion_id),
    unidades_extraidas:
      l.unidades_extraidas === null ? null : Number(l.unidades_extraidas),
  }));
  return construirReporteOrdenado(lineas);
};

const idsDelReporte = async (cargaId: number, vista: "vivo" | "original") =>
  (await reporteDe(cargaId, vista)).filas.map((f) => f.idOrden).sort((a, b) => a - b);

/* ══════════════════════════════════════════════════════════════════════════
   0. Las dos vistas exponen exactamente las mismas columnas
   ══════════════════════════════════════════════════════════════════════════ */
console.log("── Simetría de las vistas ──");

const columnasDe = async (vista: string) =>
  (await db.query<{ column_name: string }>(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = $1
      order by ordinal_position`,
    [vista],
  )).rows.map((c) => c.column_name);

check("v_lineas_carga_foto tiene las mismas columnas, en el mismo orden",
  await columnasDe("v_lineas_carga_foto"), await columnasDe("v_lineas_carga"));

/* ══════════════════════════════════════════════════════════════════════════
   1. Archivo del martes: todo nuevo y pendiente
   ══════════════════════════════════════════════════════════════════════════ */
console.log("\n── Martes: dos órdenes pendientes, sin guía ──");

const martes = await procesar("martes.xlsx", [
  {
    id_orden: 800001, estado: "PENDIENTE", fecha_orden: "2026-09-22T05:00:00Z",
    fecha_guia_generada: null, numero_guia: null,
    transportadora: null, ciudad_destino: "BOGOTA",
    lineas: [linea(1, 2)],
  },
  {
    id_orden: 800002, estado: "PENDIENTE", fecha_orden: "2026-09-22T05:00:00Z",
    fecha_guia_generada: null, numero_guia: null,
    transportadora: null, ciudad_destino: "CALI",
    lineas: [linea(2, 1)],
  },
]);
check("las dos entran como nuevas", martes.ordenes_nuevas, 2);
check("y las dos quedan fotografiadas", Number(martes.filas_foto), 2);
check("la foto las marca como nuevas",
  (await fotoDe(martes.carga_id)).map((f) => f.tipo), ["nueva", "nueva"]);
check("las dos vistas coinciden mientras nada cambió",
  await idsDelReporte(martes.carga_id, "vivo"),
  await idsDelReporte(martes.carga_id, "original"));

const fotoMartes = await fotoDe(martes.carga_id);

/* ══════════════════════════════════════════════════════════════════════════
   2. Archivo del miércoles: una se despachó
   ══════════════════════════════════════════════════════════════════════════ */
console.log("\n── Miércoles: la 800001 ya salió con guía ──");

const miercoles = await procesar("miercoles.xlsx", [
  {
    id_orden: 800001, estado: "RECOGIDO POR DROPI", fecha_orden: "2026-09-22T05:00:00Z",
    fecha_guia_generada: "2026-09-23T14:00:00Z", numero_guia: "024035099100",
    transportadora: "ENVIA", ciudad_destino: "BOGOTA",
    lineas: [linea(1, 2)],
  },
  {
    id_orden: 800002, estado: "PENDIENTE", fecha_orden: "2026-09-22T05:00:00Z",
    fecha_guia_generada: null, numero_guia: null,
    transportadora: null, ciudad_destino: "CALI",
    lineas: [linea(2, 1)],
  },
]);
check("una cambió, la otra vino igual",
  [miercoles.ordenes_actualizadas, miercoles.ordenes_sin_cambios], [1, 1]);
check("la foto del miércoles distingue las dos",
  (await fotoDe(miercoles.carga_id)).map((f) => [f.id_orden, f.tipo]),
  [[800001, "actualizada"], [800002, "sin_cambios"]]);

console.log("\n  · La vista en vivo se comporta igual que hoy en producción:");
check("    el reporte en vivo del martes quedó vacío (las órdenes se mudaron)",
  await idsDelReporte(martes.carga_id, "vivo"), []);
check("    el del miércoles muestra solo la que sigue pendiente",
  await idsDelReporte(miercoles.carga_id, "vivo"), [800002]);

console.log("\n  · Y la foto del martes sigue intacta:");
check("    la foto del martes no se tocó, campo por campo",
  await fotoDe(martes.carga_id), fotoMartes);
check("    el reporte histórico del martes sigue mostrando sus 2 pendientes",
  await idsDelReporte(martes.carga_id, "original"), [800001, 800002]);
check("    con el estado del martes, no el de hoy",
  (await reporteDe(martes.carga_id, "original")).filas.map((f) => f.numeroGuia),
  [null, null]);

// Esto es lo que hace peligroso mezclar las vistas, y por eso la pantalla
// tiene que decir cuál se está mirando.
check("    la 800001 está PENDIENTE en la foto y despachada en vivo",
  [
    (await idsDelReporte(martes.carga_id, "original")).includes(800001),
    (await idsDelReporte(miercoles.carga_id, "vivo")).includes(800001),
  ],
  [true, false]);

const fotoMiercoles = await fotoDe(miercoles.carga_id);

/* ══════════════════════════════════════════════════════════════════════════
   3. Una fila desactualizada igual queda fotografiada
   ══════════════════════════════════════════════════════════════════════════ */
console.log("\n── Se resube por error el archivo del martes ──");

const resubido = await procesar("martes.xlsx (resubido el jueves)", [
  {
    id_orden: 800001, estado: "PENDIENTE", fecha_orden: "2026-09-22T05:00:00Z",
    fecha_guia_generada: null, numero_guia: null,
    transportadora: null, ciudad_destino: "BOGOTA",
    lineas: [linea(1, 2)],
  },
]);
check("la fila se ignora por desactualizada",
  resubido.ids_desactualizados.map(Number), [800001]);
check("no actualiza nada en ordenes",
  [resubido.ordenes_nuevas, resubido.ordenes_actualizadas], [0, 0]);

// El punto de la tabla: hoy un archivo viejo no deja ningún rastro.
check("PERO igual queda fotografiada", Number(resubido.filas_foto), 1);
check("marcada como desactualizada, y con lo que decía el archivo",
  await fotoDe(resubido.carga_id),
  [{
    id_orden: 800001, estado: "PENDIENTE", numero_guia: null,
    tiene_fecha_guia: false, transportadora: null, ciudad_destino: "BOGOTA",
    tipo: "desactualizada",
  }]);

check("la orden en la base quedó como estaba: despachada",
  (await db.query<{ estado: string; numero_guia: string }>(
    "select estado, numero_guia from ordenes where id_orden = 800001")).rows[0],
  { estado: "RECOGIDO POR DROPI", numero_guia: "024035099100" });

check("y la foto del miércoles tampoco se movió",
  await fotoDe(miercoles.carga_id), fotoMiercoles);

/* ══════════════════════════════════════════════════════════════════════════
   4. Bordes
   ══════════════════════════════════════════════════════════════════════════ */
console.log("\n── Bordes ──");

// El payload puede traer la misma orden dos veces (dos filas del Excel de la
// misma orden). Sin el `distinct on`, el PK compuesto abortaría la carga.
const duplicada = await procesar("con_orden_repetida.xlsx", [
  {
    id_orden: 800003, estado: "PENDIENTE", fecha_orden: "2026-09-25T05:00:00Z",
    fecha_guia_generada: null, numero_guia: null,
    transportadora: null, ciudad_destino: "MEDELLIN",
    lineas: [linea(1, 1)],
  },
  {
    id_orden: 800003, estado: "PENDIENTE", fecha_orden: "2026-09-25T05:00:00Z",
    fecha_guia_generada: null, numero_guia: null,
    transportadora: null, ciudad_destino: "MEDELLIN",
    lineas: [linea(2, 1)],
  },
]);
check("la orden repetida en el archivo deja una sola fila de foto",
  Number(duplicada.filas_foto), 1);

// Una carga vieja, anterior a esta migración, no tiene foto: la pantalla se
// apoya en eso para no ofrecer una vista histórica vacía.
await db.exec(`
  insert into cargas (nombre_archivo, filas_leidas, filas_con_error)
  values ('carga_anterior_a_la_foto.xlsx', 0, 0);
`);
const sinFoto = Number((await db.query<{ id: string }>(
  "select id from cargas order by id desc limit 1")).rows[0].id);
check("una carga sin foto no tiene filas",
  (await fotoDe(sinFoto)).length, 0);
check("y su reporte histórico sale vacío (por eso la pantalla lo esconde)",
  await idsDelReporte(sinFoto, "original"), []);

// La foto es de sola inserción: authenticated no puede reescribir la historia.
const puede = async (privilegio: string) =>
  (await db.query<{ ok: boolean }>(
    "select has_table_privilege('authenticated', 'public.carga_ordenes_foto', $1) as ok",
    [privilegio],
  )).rows[0].ok;
check("authenticated solo puede leer la foto",
  [await puede("SELECT"), await puede("INSERT"),
   await puede("UPDATE"), await puede("DELETE")],
  [true, false, false, false]);

console.log(`\n${fallos === 0 ? "FOTO DE CARGA CORRECTA" : `${fallos} FALLOS`}`);
process.exit(fallos ? 1 : 0);
