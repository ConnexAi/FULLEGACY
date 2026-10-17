/**
 * Historial mensual: la agregación en SQL (contra un Postgres real) y el
 * armado de las hojas.
 */
import { readFileSync } from "node:fs";

import { PGlite } from "@electric-sql/pglite";

import {
  ESTADOS_NO_COMPLETADOS,
  aplanarHistorialMensual,
  construirHistorialMensual,
  diaDeLaSemana,
  diasDelMes,
  esMesValido,
  etiquetaDeMes,
  resumirPorDia,
  type AgregadoDia,
  type FilaHistorialMensual,
  type TotalDia,
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
  "20260914100000_totales_diarios.sql",
  "20260915100000_historial_mensual_por_producto.sql",
  "20260924210000_actualizar_ordenes_repetidas.sql",
  "20260924220000_ignorar_filas_desactualizadas.sql",
  "20260925100000_carga_ordenes_foto.sql",
  "20261009100000_latidos.sql",
  "20261017100000_historial_mensual_ordenes.sql",
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

// `historial_mensual()` devuelve una fila por producto con los días
// agregados adentro (ver la migración de reestructuración): se pide tal cual
// y se aplana con la misma función que usa la app, para probar el contrato
// real de punta a punta, no una forma auxiliar solo de la prueba.
const agregar = async (anio: number, mes: number, estados: string[]) => {
  const filas = (await db.query<{ producto_id: number | string; dias: FilaHistorialMensual["dias"] }>(
    "select * from public.historial_mensual($1, $2, $3::text[])",
    [anio, mes, estados],
  )).rows.map((f) => ({ producto_id: Number(f.producto_id), dias: f.dias }));

  return aplanarHistorialMensual(filas);
};

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
console.log("\n── Solo generan hoja los productos CON pedidos ese mes ──");
const productos = [
  { id: 1, nombre: "Hydra" },
  { id: 2, nombre: "Waggy pet" },
  { id: 3, nombre: "Producto sin ventas" },
];
const historial = construirHistorialMensual(2026, 9, productos, septiembre);

// El catálogo tiene 3 productos, pero septiembre solo trajo pedidos para 2.
check("un catálogo de 3 con solo 2 activos genera solo 2 hojas, no las 3",
  historial.hojas.length, 2);
check("el producto SIN pedidos ese mes no aparece",
  historial.hojas.some((h) => h.producto.id === 3), false);
check("los que sí tuvieron pedidos, ordenados A→Z",
  historial.hojas.map((h) => h.producto.nombre), ["Hydra", "Waggy pet"]);
check("cada hoja que sí se genera trae los 30 días completos",
  historial.hojas.map((h) => h.filas.length), [30, 30]);
check("el tamaño del catálogo completo queda disponible aparte",
  historial.totalProductosEnCatalogo, 3);

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

console.log("\n── Un mes sin NINGÚN producto activo no rompe nada ──");
const futuro = construirHistorialMensual(2026, 12, productos, []);
check("diciembre sin datos: cero hojas (no las 3 del catálogo)",
  futuro.hojas.length, 0);
check("pero el tamaño del catálogo se conserva",
  futuro.totalProductosEnCatalogo, 3);

console.log("\n── Un mes incompleto (en curso) sí genera sus hojas activas ──");
const febrero: AgregadoDia[] = [
  { producto_id: 1, dia: 5, pedidos: 2, unidades: 2, no_completados: 0 },
];
const incompleto = construirHistorialMensual(2026, 2, productos, febrero);
check("solo el producto con pedidos genera hoja", incompleto.hojas.length, 1);
check("febrero conserva sus 28 filas completas",
  incompleto.hojas[0].filas.length, 28);

/* ── Totales agregados: el combo cuenta UNA vez ─────────────────────────── */
console.log("\n── Totales que cruzan productos ──");

const totalesDiarios = (await db.query<TotalDia>(
  "select * from public.totales_diarios($1, $2)", [2026, 9],
)).rows.map((f) => ({
  dia: Number(f.dia), pedidos: Number(f.pedidos), unidades: Number(f.unidades),
}));

// El día 10 tiene UNA orden (la 108) con dos productos.
const porProductoDia10 = septiembre.filter((f) => f.dia === 10);
check("por producto, el combo aparece en sus dos productos",
  porProductoDia10.map((f) => f.producto_id).sort(), [1, 2]);
check("y sumar esas filas daría 2 pedidos — el error que se corrigió",
  porProductoDia10.reduce((n, f) => n + f.pedidos, 0), 2);
check("el total diario lo cuenta UNA sola vez",
  totalesDiarios.find((d) => d.dia === 10)?.pedidos, 1);
check("pero sus unidades sí suman las dos líneas (1 + 2)",
  totalesDiarios.find((d) => d.dia === 10)?.unidades, 3);

console.log("\n── Días sin combo dan igual por las dos vías ──");
for (const dia of [3, 5, 8]) {
  check(`día ${dia}: mismo conteo`,
    totalesDiarios.find((d) => d.dia === dia)?.pedidos,
    septiembre.filter((f) => f.dia === dia).reduce((n, f) => n + f.pedidos, 0));
}

console.log("\n── Las hojas del Excel NO cambian ──");
check("cada hoja sigue contando sus propias órdenes",
  historial.hojas.find((h) => h.producto.id === 1)!.filas.find((f) => f.dia === 10)?.pedidos, 1);
check("y el producto del combo también la registra",
  septiembre.find((f) => f.producto_id === 2 && f.dia === 10)?.pedidos, 1);

/* ── Serie diaria del vistazo de inicio ─────────────────────────────────── */
console.log("\n── Vistazo de inicio: pedidos por día ──");

const serie = resumirPorDia(2026, 9, totalesDiarios, 12);
check("la serie se corta en el día indicado (hoy)", serie.dias.length, 12);
check("y el último día es ese", serie.ultimoDia, 12);
check("el día 3 trae sus dos órdenes", serie.dias.find((d) => d.dia === 3)?.pedidos, 2);
check("el día del combo marca 1 pedido, no 2",
  serie.dias.find((d) => d.dia === 10)?.pedidos, 1);
check("los días sin despachos quedan en cero, no ausentes",
  serie.dias.find((d) => d.dia === 2), { dia: 2, esJueves: false, pedidos: 0, unidades: 0 });
check("los jueves quedan marcados también acá",
  serie.dias.filter((d) => d.esJueves).map((d) => d.dia), [3, 10]);
// día 3 (2 ped / 3 uni) + día 5 (1/4) + día 8 (1/3) + día 10 (1/3)
check("totales de la serie", [serie.totalPedidos, serie.totalUnidades], [5, 13]);

console.log("\n── El corte por día de hoy ──");
check("un mes recién empezado deja un solo punto",
  resumirPorDia(2026, 9, totalesDiarios, 1).dias.map((d) => d.dia), [1]);
check("sin corte, la serie llega al fin del mes",
  resumirPorDia(2026, 9, totalesDiarios).dias.length, 30);
check("un corte más allá del mes se limita al último día",
  resumirPorDia(2026, 9, totalesDiarios, 99).dias.length, 30);
check("día 0 (caso límite) no rompe: serie vacía",
  resumirPorDia(2026, 9, totalesDiarios, 0).dias.length, 0);
check("un mes sin datos da la serie completa en cero",
  resumirPorDia(2026, 12, [], 31).dias.every((d) => d.pedidos === 0 && d.unidades === 0), true);

console.log("\n── El total del mes es la suma de los días ──");
// Cada orden tiene una sola fecha de guía, así que pertenece a un único día:
// sumar los conteos diarios no vuelve a contar nada.
const septiembreCompleto = resumirPorDia(2026, 9, totalesDiarios);
check("suma de días = órdenes únicas del mes",
  septiembreCompleto.totalPedidos,
  Number((await db.query<{c: number}>(`select count(distinct o.id_orden)::int c
     from ordenes o where o.fecha_guia_generada is not null
     and (o.fecha_guia_generada at time zone 'America/Bogota')::date
         between '2026-09-01' and '2026-09-30'`)).rows[0].c));

console.log("\n── Mes sin datos ──");
const vacio = (await db.query<TotalDia>("select * from public.totales_diarios($1, $2)", [2026, 12])).rows;
check("diciembre no devuelve filas", vacio.length, 0);

/* ── El contrato ya no depende de los días: catálogo grande ─────────────── */
console.log("\n── Catálogo grande: 42 productos vendiendo los 31 días de octubre ──");

// Con la forma vieja (una fila por producto × día), esto habría sido
// 42 × 31 = 1302 filas — por encima del tope de PostgREST (típicamente 1000).
// Con la nueva forma (una fila por producto), debe seguir siendo 42.
await db.exec(`
  insert into productos (id, nombre, sku)
  select 1000 + n, 'Producto masivo ' || lpad(n::text, 2, '0'), null
  from generate_series(1, 42) as n;

  insert into ordenes (id_orden, estado, fecha_orden, fecha_guia_generada, carga_id)
  select
    9000000 + (p.n - 1) * 100 + d.dia,
    'ENTREGADO',
    (make_date(2026, 10, d.dia) + time '15:00') at time zone 'America/Bogota',
    (make_date(2026, 10, d.dia) + time '15:00') at time zone 'America/Bogota',
    1
  from generate_series(1, 42) as p(n)
  cross join generate_series(1, 31) as d(dia);

  insert into orden_productos (orden_id, producto_id, variacion_id, cantidad, linea)
  select
    9000000 + (p.n - 1) * 100 + d.dia,
    1000 + p.n,
    null,
    1,
    1
  from generate_series(1, 42) as p(n)
  cross join generate_series(1, 31) as d(dia);
`);

check("octubre 2026 tiene 31 días (el escenario que se quería estresar)",
  diasDelMes(2026, 10), 31);

const filasOctubre = (await db.query<{ producto_id: number | string; dias: FilaHistorialMensual["dias"] }>(
  "select * from public.historial_mensual($1, $2, $3::text[])",
  [2026, 10, []],
)).rows;

check("una fila por producto — NO una por (producto, día)",
  filasOctubre.length, 42);
check("muy por debajo de cualquier tope de PostgREST (1000)",
  filasOctubre.length < 1000, true);
check("cada producto trae sus 31 días adentro, en el array",
  filasOctubre.every((f) => f.dias.length === 31), true);
check("un día cualquiera trae la forma esperada",
  filasOctubre[0].dias.find((d) => d.dia === 15),
  { dia: 15, pedidos: 1, unidades: 1, no_completados: 0 });

const octubreAplanado = aplanarHistorialMensual(
  filasOctubre.map((f) => ({ producto_id: Number(f.producto_id), dias: f.dias })),
);
check("aplanado, son los 1302 (producto, día) reales — no se perdió nada",
  octubreAplanado.length, 42 * 31);

const catalogoGrande = Array.from({ length: 42 }, (_, i) => ({
  id: 1000 + i + 1, nombre: `Producto masivo ${String(i + 1).padStart(2, "0")}`,
}));
const historialGrande = construirHistorialMensual(2026, 10, catalogoGrande, octubreAplanado);
check("construirHistorialMensual arma las 42 hojas igual que siempre",
  historialGrande.hojas.length, 42);
check("cada hoja: 31 filas, 1 pedido y 1 unidad cada una",
  historialGrande.hojas.every((h) =>
    h.filas.length === 31 && h.filas.every((f) => f.pedidos === 1 && f.unidades === 1)), true);
check("totales de una hoja cualquiera",
  [historialGrande.hojas[0].totalPedidos, historialGrande.hojas[0].totalUnidades], [31, 31]);

console.log(`\n${fallos === 0 ? "HISTORIAL MENSUAL CORRECTO" : `${fallos} FALLOS`}`);
process.exit(fallos ? 1 : 0);
