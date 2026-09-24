/**
 * Órdenes repetidas: se actualizan con el archivo nuevo, no se descartan.
 *
 * Reproduce el bug de producción del 2026-09-24. Diego subía un archivo a las
 * 09:54 y otro a las 15:16 del mismo día. Las órdenes que en el primero
 * estaban PENDIENTE sin guía quedaban congeladas así para siempre: el segundo
 * archivo, que ya las traía con guía, se descartaba entero por repetido. Las
 * órdenes nunca entraban al historial mensual porque el historial exige
 * `fecha_guia_generada`.
 *
 * Se prueba contra Postgres real, con las migraciones del repo y la misma
 * llamada RPC que hace la app.
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
  lineas_insertadas: number;
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
      archivo: { nombre, filas_leidas: 0, filas_con_error: 0 },
      productos: PRODUCTOS,
      variaciones: [],
      ordenes,
    }),
  ])).rows[0].r;

const leerOrden = async (id: number) =>
  (await db.query<{
    estado: string; numero_guia: string | null; fecha_guia_generada: string | null;
    transportadora: string | null; ciudad_destino: string | null; carga_id: number | string;
  }>(
    `select estado, numero_guia, fecha_guia_generada, transportadora, ciudad_destino, carga_id
       from ordenes where id_orden = $1`,
    [id],
  )).rows[0];

/** Pedidos que el historial mensual cuenta para un producto en septiembre 2026. */
const pedidosEnHistorial = async (productoId: number) => {
  const filas = (await db.query<{ producto_id: string; dias: { dia: number; pedidos: number }[] }>(
    "select * from public.historial_mensual(2026, 9, '{}'::text[])",
  )).rows;
  const fila = filas.find((f) => Number(f.producto_id) === productoId);
  return (fila?.dias ?? []).reduce((n, d) => n + Number(d.pedidos), 0);
};

const linea = (producto: number, cantidad = 1) => ({
  producto_id: producto, variacion_id: null as null, cantidad, linea: 1,
});

/* ══════════════════════════════════════════════════════════════════════════
   1. El bug real: la orden congelada en PENDIENTE sin guía
   ══════════════════════════════════════════════════════════════════════════ */
console.log("── Archivo de la mañana: la orden llega PENDIENTE, sin guía ──");

const manana = await procesar("manana_0954.xlsx", [
  {
    id_orden: 90688642, estado: "PENDIENTE", fecha_orden: "2026-09-24T05:00:00Z",
    fecha_guia_generada: null, numero_guia: null,
    transportadora: null, ciudad_destino: "BOGOTA",
    lineas: [linea(1, 2)],
  },
]);
check("entra como nueva", manana.ordenes_nuevas, 1);
check("sin repetidas", [manana.ordenes_actualizadas, manana.ordenes_sin_cambios], [0, 0]);
check("el historial NO la cuenta: no tiene fecha de guía", await pedidosEnHistorial(1), 0);

console.log("\n── Archivo de la tarde: la misma orden, ya recogida y con guía ──");

const tarde = await procesar("tarde_1516.xlsx", [
  {
    id_orden: 90688642, estado: "RECOGIDO POR DROPI", fecha_orden: "2026-09-24T05:00:00Z",
    fecha_guia_generada: "2026-09-24T19:30:00Z", numero_guia: "024035099001",
    transportadora: "ENVIA", ciudad_destino: "BOGOTA",
    lineas: [linea(1, 2)],
  },
]);
check("no cuenta como nueva", tarde.ordenes_nuevas, 0);
check("cuenta como actualizada, no como sin cambios",
  [tarde.ordenes_actualizadas, tarde.ordenes_sin_cambios], [1, 0]);

const actualizada = await leerOrden(90688642);
check("el estado quedó con el del archivo nuevo", actualizada.estado, "RECOGIDO POR DROPI");
check("la guía quedó guardada", actualizada.numero_guia, "024035099001");
check("la fecha de guía quedó guardada",
  new Date(actualizada.fecha_guia_generada!).toISOString(), "2026-09-24T19:30:00.000Z");
check("la transportadora también se actualizó", actualizada.transportadora, "ENVIA");

// Esto es lo que Diego estaba viendo mal: la orden ya despachada no aparecía.
check("AHORA el historial mensual sí la cuenta", await pedidosEnHistorial(1), 1);

/* ══════════════════════════════════════════════════════════════════════════
   2. coalesce: un archivo viejo no puede borrar una guía que ya tenemos
   ══════════════════════════════════════════════════════════════════════════ */
console.log("\n── Se resube por error el archivo viejo (guía en NULL) ──");

const reSubida = await procesar("manana_0954.xlsx (resubido)", [
  {
    id_orden: 90688642, estado: "PENDIENTE", fecha_orden: "2026-09-24T05:00:00Z",
    fecha_guia_generada: null, numero_guia: null,
    transportadora: null, ciudad_destino: "BOGOTA",
    lineas: [linea(1, 2)],
  },
]);
check("se procesa como actualización", reSubida.ordenes_actualizadas, 1);

const trasResubir = await leerOrden(90688642);
check("la fecha de guía NO se borró (coalesce)",
  new Date(trasResubir.fecha_guia_generada!).toISOString(), "2026-09-24T19:30:00.000Z");
check("el número de guía tampoco", trasResubir.numero_guia, "024035099001");
// Estos sí se sobrescriben directo, sin coalesce: es lo acordado.
check("el estado sí se sobrescribe con el del archivo", trasResubir.estado, "PENDIENTE");
check("la transportadora también vuelve a NULL", trasResubir.transportadora, null);
check("y el historial la sigue contando, porque conserva la fecha de guía",
  await pedidosEnHistorial(1), 1);

/* ══════════════════════════════════════════════════════════════════════════
   3. carga_id: la orden se muda a la carga más reciente
   ══════════════════════════════════════════════════════════════════════════ */
console.log("\n── carga_id se muda, y el Reporte Ordenado sigue a la orden ──");

const cargaA = await procesar("archivo_A.xlsx", [
  {
    id_orden: 700001, estado: "PENDIENTE", fecha_orden: "2026-09-24T05:00:00Z",
    fecha_guia_generada: null, numero_guia: null,
    transportadora: "ENVIA", ciudad_destino: "MEDELLIN",
    lineas: [linea(2, 3)],
  },
  {
    id_orden: 700002, estado: "PENDIENTE", fecha_orden: "2026-09-24T05:00:00Z",
    fecha_guia_generada: null, numero_guia: null,
    transportadora: "ENVIA", ciudad_destino: "CALI",
    lineas: [linea(2, 1)],
  },
]);

const reporteDe = async (cargaId: number) => {
  const lineas = (await db.query<LineaCarga>(
    `select carga_id, id_orden, estado, estado_normalizado, numero_guia,
            transportadora, ciudad_destino, linea, producto_id, producto_nombre,
            variacion_id, texto_variacion, unidades_extraidas, cantidad::int as cantidad
       from v_lineas_carga
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

check("el reporte de la carga A muestra sus 2 pendientes",
  (await reporteDe(cargaA.carga_id)).filas.map((f) => f.idOrden).sort(), [700001, 700002]);

// Archivo B: una ya salió a despacho, la otra sigue pendiente.
const cargaB = await procesar("archivo_B.xlsx", [
  {
    id_orden: 700001, estado: "RECOGIDO POR DROPI", fecha_orden: "2026-09-24T05:00:00Z",
    fecha_guia_generada: "2026-09-24T20:00:00Z", numero_guia: "024035099002",
    transportadora: "ENVIA", ciudad_destino: "MEDELLIN",
    lineas: [linea(2, 3)],
  },
  {
    id_orden: 700002, estado: "PENDIENTE", fecha_orden: "2026-09-24T05:00:00Z",
    fecha_guia_generada: null, numero_guia: null,
    transportadora: "ENVIA", ciudad_destino: "CALI",
    lineas: [linea(2, 1)],
  },
]);
check("una cambió, la otra vino idéntica",
  [cargaB.ordenes_actualizadas, cargaB.ordenes_sin_cambios], [1, 1]);

check("la que cambió apunta a la carga nueva",
  Number((await leerOrden(700001)).carga_id), cargaB.carga_id);
check("la que NO cambió también se mudó (opción B)",
  Number((await leerOrden(700002)).carga_id), cargaB.carga_id);

check("el reporte de la carga vieja quedó vacío",
  (await reporteDe(cargaA.carga_id)).filas.length, 0);
check("el reporte de la carga nueva muestra solo la que sigue pendiente",
  (await reporteDe(cargaB.carga_id)).filas.map((f) => f.idOrden), [700002]);

/* ══════════════════════════════════════════════════════════════════════════
   4. Archivo idéntico y líneas de producto
   ══════════════════════════════════════════════════════════════════════════ */
console.log("\n── Resubir el mismo archivo no cambia nada ──");

const lineasAntes = Number(
  (await db.query<{ c: number }>("select count(*)::int c from orden_productos")).rows[0].c,
);

const repetido = await procesar("archivo_B.xlsx (otra vez)", [
  {
    id_orden: 700001, estado: "RECOGIDO POR DROPI", fecha_orden: "2026-09-24T05:00:00Z",
    fecha_guia_generada: "2026-09-24T20:00:00Z", numero_guia: "024035099002",
    transportadora: "ENVIA", ciudad_destino: "MEDELLIN",
    lineas: [linea(2, 3)],
  },
  {
    id_orden: 700002, estado: "PENDIENTE", fecha_orden: "2026-09-24T05:00:00Z",
    fecha_guia_generada: null, numero_guia: null,
    transportadora: "ENVIA", ciudad_destino: "CALI",
    lineas: [linea(2, 1)],
  },
]);
check("nada nuevo, nada actualizado, las 2 sin cambios",
  [repetido.ordenes_nuevas, repetido.ordenes_actualizadas, repetido.ordenes_sin_cambios],
  [0, 0, 2]);
check("no se insertó ninguna línea de producto", repetido.lineas_insertadas, 0);
check("orden_productos quedó igual",
  Number((await db.query<{ c: number }>("select count(*)::int c from orden_productos")).rows[0].c),
  lineasAntes);
check("la cantidad de la línea tampoco cambió",
  Number((await db.query<{ cantidad: number }>(
    "select cantidad from orden_productos where orden_id = 700001")).rows[0].cantidad), 3);

console.log("\n── Los contadores quedan guardados en la carga ──");
const contadores = (await db.query<{
  nombre_archivo: string; ordenes_nuevas: number;
  ordenes_actualizadas: number; ordenes_sin_cambios: number;
}>(
  `select nombre_archivo, ordenes_nuevas, ordenes_actualizadas, ordenes_sin_cambios
     from cargas where id = $1`,
  [repetido.carga_id],
)).rows[0];
check("la fila de cargas refleja el resumen que ve Diego",
  [Number(contadores.ordenes_nuevas), Number(contadores.ordenes_actualizadas),
   Number(contadores.ordenes_sin_cambios)],
  [0, 0, 2]);

console.log(
  `\n${fallos === 0 ? "ACTUALIZACIÓN DE ÓRDENES REPETIDAS CORRECTA" : `${fallos} FALLOS`}`,
);
process.exit(fallos ? 1 : 0);
