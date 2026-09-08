/**
 * Historial mensual: la agregación en SQL (contra un Postgres real) y el
 * armado de las hojas.
 */
import { readFileSync } from "node:fs";

import { PGlite } from "@electric-sql/pglite";

import {
  ESTADOS_NO_COMPLETADOS,
  construirHistorialMensual,
  diaDeLaSemana,
  diasDelMes,
  esMesValido,
  etiquetaDeMes,
  type AgregadoDia,
} from "@/lib/reportes/historial-mensual";

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
];

let fallos = 0;
const check = (n: string, real: unknown, esp: unknown) => {
  const ok = JSON.stringify(real) === JSON.stringify(esp);
  if (!ok) fallos++;
  console.log(`${ok ? "  ok  " : "FALLA"} ${n}` +
    (ok ? "" : `\n        esperado: ${JSON.stringify(esp)}\n        real:     ${JSON.stringify(real)}`));
};

/* ── Utilidades de calendario ───────────────────────────────────────────── */
console.log("── Calendario ──");
check("septiembre 2026 tiene 30 días", diasDelMes(2026, 9), 30);
check("febrero 2026 tiene 28", diasDelMes(2026, 2), 28);
check("febrero 2028 (bisiesto) tiene 29", diasDelMes(2028, 2), 29);
check("el 3 de septiembre de 2026 es jueves", diaDeLaSemana(2026, 9, 3), 4);
check("el 4 no lo es", diaDeLaSemana(2026, 9, 4), 5);
check("etiqueta del mes", etiquetaDeMes(2026, 9), "Septiembre 2026");
check("mes 13 es inválido", esMesValido(2026, 13), false);
check("mes 0 es inválido", esMesValido(2026, 0), false);
check("septiembre 2026 es válido", esMesValido(2026, 9), true);

/* ── Base de datos ──────────────────────────────────────────────────────── */
const db = await PGlite.create();
await db.exec("create role anon; create role authenticated; create role service_role;");
await db.exec("create schema auth; create table auth.users (id uuid primary key default gen_random_uuid(), email text);");
for (const m of MIGRACIONES) await db.exec(readFileSync(`${RAIZ}supabase/migrations/${m}`, "utf8"));

await db.exec(`
  insert into cargas (nombre_archivo) values ('prueba.xlsx');
  insert into productos (id, nombre, sku) values
    (1, 'Hydra', null), (2, 'Waggy pet', 'SKU-W'), (3, 'Producto sin ventas', 'SKU-Z');
  insert into producto_variaciones (id, producto_id, sku, texto_variacion, unidades_extraidas)
    values (11, 1, '463830-0', '1 unidad', 1);
`);

/** Alta de una orden con su línea, en una sola sentencia. */
async function orden(opciones: {
  id: number; estado: string; guia: string | null; producto: number;
  variacion?: number | null; cantidad?: number;
}) {
  await db.query(
    `insert into ordenes (id_orden, estado, fecha_orden, fecha_guia_generada, carga_id)
       values ($1, $2, '2026-09-01T12:00:00Z', $3, 1)`,
    [opciones.id, opciones.estado, opciones.guia],
  );
  await db.query(
    `insert into orden_productos (orden_id, producto_id, variacion_id, cantidad, linea)
       values ($1, $2, $3, $4, 1)`,
    [opciones.id, opciones.producto, opciones.variacion ?? null, opciones.cantidad ?? 1],
  );
}

// Día 3 (jueves): dos despachadas, una de ellas DEVOLUCION.
await orden({ id: 101, estado: "ENTREGADO",  guia: "2026-09-03T15:00:00Z", producto: 1, variacion: 11, cantidad: 2 });
await orden({ id: 102, estado: "DEVOLUCION", guia: "2026-09-03T16:00:00Z", producto: 1, variacion: 11, cantidad: 1 });
// SIN fecha de guía: nunca salió, no debe contar.
await orden({ id: 103, estado: "PENDIENTE",  guia: null,                    producto: 1, variacion: 11, cantidad: 9 });
await orden({ id: 104, estado: "CANCELADO",  guia: null,                    producto: 1, variacion: 11, cantidad: 7 });
// Día 5, otro producto.
await orden({ id: 105, estado: "ENTREGADO",  guia: "2026-09-05T14:00:00Z", producto: 2, cantidad: 4 });
// Guía a las 9 pm del día 8 en Bogotá = 02:00 UTC del 9: debe caer en el 8.
await orden({ id: 106, estado: "ENTREGADO",  guia: "2026-09-09T02:00:00Z", producto: 2, cantidad: 3 });
// De otro mes: fuera del rango.
await orden({ id: 107, estado: "ENTREGADO",  guia: "2026-08-20T15:00:00Z", producto: 1, variacion: 11, cantidad: 5 });
// Combo: una orden con dos productos, aporta a cada uno.
await db.query(`insert into ordenes (id_orden, estado, fecha_orden, fecha_guia_generada, carga_id)
  values (108, 'ENTREGADO', '2026-09-01T12:00:00Z', '2026-09-10T15:00:00Z', 1)`);
await db.query(`insert into orden_productos (orden_id, producto_id, variacion_id, cantidad, linea) values
  (108, 1, 11, 1, 1), (108, 2, null, 2, 2)`);

const agregar = async (anio: number, mes: number, estados: string[]) =>
  (await db.query<AgregadoDia>(
    "select * from public.historial_mensual($1, $2, $3::text[])",
    [anio, mes, estados],
  )).rows.map((f) => ({
    producto_id: Number(f.producto_id), dia: Number(f.dia), pedidos: Number(f.pedidos),
    unidades: Number(f.unidades), no_completados: Number(f.no_completados),
  }));

const septiembre = await agregar(2026, 9, [...ESTADOS_NO_COMPLETADOS]);

console.log("\n── Solo cuentan las órdenes CON fecha de guía generada ──");
const dia3 = septiembre.find((f) => f.producto_id === 1 && f.dia === 3);
check("día 3: 2 pedidos (las 2 con guía)", dia3?.pedidos, 2);
check("día 3: 3 unidades (2+1), sin las 16 sin guía", dia3?.unidades, 3);
check("las órdenes PENDIENTE/CANCELADO no aparecen en ningún día",
  septiembre.filter((f) => f.unidades >= 7).length, 0);

console.log("\n── Conteo preliminar con la lista de un solo estado ──");
check("la constante hoy tiene un valor", [...ESTADOS_NO_COMPLETADOS], ["DEVOLUCION"]);
check("día 3: 1 no completado (la DEVOLUCION)", dia3?.no_completados, 1);
const dia5 = septiembre.find((f) => f.producto_id === 2 && f.dia === 5);
check("día 5: 0 no completados", dia5?.no_completados, 0);
const sinLista = await agregar(2026, 9, []);
check("con la lista vacía, ningún no completado",
  sinLista.reduce((n, f) => n + f.no_completados, 0), 0);
const listaAmpliada = await agregar(2026, 9, ["DEVOLUCION", "ENTREGADO"]);
check("agregar un estado a la lista es solo eso: cambia el conteo",
  listaAmpliada.find((f) => f.producto_id === 1 && f.dia === 3)?.no_completados, 2);

console.log("\n── El día se calcula en hora de Bogotá ──");
check("guía del 09/09 02:00 UTC = 9 pm del día 8 en Bogotá",
  septiembre.find((f) => f.producto_id === 2 && f.unidades === 3)?.dia, 8);

console.log("\n── Rango del mes ──");
check("la orden de agosto no entra en septiembre",
  septiembre.some((f) => f.unidades === 5), false);
const agosto = await agregar(2026, 8, [...ESTADOS_NO_COMPLETADOS]);
check("pero sí en agosto", agosto.find((f) => f.dia === 20)?.unidades, 5);

console.log("\n── Combos: cada producto del combo suma por separado ──");
check("Hydra recibe su línea del combo",
  septiembre.find((f) => f.producto_id === 1 && f.dia === 10)?.pedidos, 1);
check("Waggy pet también",
  septiembre.find((f) => f.producto_id === 2 && f.dia === 10)?.unidades, 2);

/* ── Armado de las hojas ────────────────────────────────────────────────── */
console.log("\n── Una hoja por producto, todos los días del mes ──");
const productos = [
  { id: 1, nombre: "Hydra" },
  { id: 2, nombre: "Waggy pet" },
  { id: 3, nombre: "Producto sin ventas" },
];
const historial = construirHistorialMensual(2026, 9, productos, septiembre);

check("una hoja por producto del catálogo", historial.hojas.length, 3);
check("ordenadas A→Z", historial.hojas.map((h) => h.producto.nombre),
  ["Hydra", "Producto sin ventas", "Waggy pet"]);
check("cada hoja trae los 30 días de septiembre",
  historial.hojas.map((h) => h.filas.length), [30, 30, 30]);

const sinVentas = historial.hojas.find((h) => h.producto.id === 3)!;
check("un producto sin pedidos igual tiene hoja",
  [sinVentas.totalPedidos, sinVentas.totalUnidades], [0, 0]);
check("con todos sus días en cero",
  sinVentas.filas.every((f) => f.pedidos === 0 && f.unidades === 0), true);

const hydra = historial.hojas.find((h) => h.producto.id === 1)!;
check("los días sin movimiento quedan en cero, no ausentes",
  hydra.filas.find((f) => f.dia === 1), {
    dia: 1, diaSemana: 2, esJueves: false, pedidos: 0, unidades: 0,
    devoluciones: null, noCompletados: 0,
  });
check("el día 3 refleja la agregación",
  [hydra.filas[2].pedidos, hydra.filas[2].unidades, hydra.filas[2].noCompletados], [2, 3, 1]);
check("totales de la hoja",
  [hydra.totalPedidos, hydra.totalUnidades, hydra.totalNoCompletados], [3, 4, 1]);

console.log("\n── La columna de devoluciones va en blanco ──");
check("ninguna fila la trae con valor",
  hydra.filas.every((f) => f.devoluciones === null), true);

console.log("\n── Jueves marcados ──");
check("los jueves de septiembre 2026 son 3, 10, 17 y 24",
  hydra.filas.filter((f) => f.esJueves).map((f) => f.dia), [3, 10, 17, 24]);

console.log("\n── Un mes incompleto no rompe nada ──");
const futuro = construirHistorialMensual(2026, 12, productos, []);
check("diciembre sin datos: 3 hojas de 31 filas",
  [futuro.hojas.length, futuro.hojas[0].filas.length], [3, 31]);
check("todo en cero, sin excepciones",
  futuro.hojas.every((h) => h.filas.every((f) => f.pedidos === 0 && f.unidades === 0)), true);
check("febrero incompleto conserva sus 28 filas",
  construirHistorialMensual(2026, 2, productos, []).hojas[0].filas.length, 28);

console.log(`\n${fallos === 0 ? "HISTORIAL MENSUAL CORRECTO" : `${fallos} FALLOS`}`);
process.exit(fallos ? 1 : 0);
