/**
 * Reporte Ordenado: filtro de estados, TIPO, orden de agrupación y conteo.
 * Prueba la función real sobre líneas planas como las que devuelve la vista.
 */
import {
  construirReporteOrdenado,
  esEstadoDelReporte,
  type LineaCarga,
} from "@/lib/reportes/reporte-ordenado";

let fallos = 0;
const check = (n: string, real: unknown, esp: unknown) => {
  const ok = JSON.stringify(real) === JSON.stringify(esp);
  if (!ok) fallos++;
  console.log(`${ok ? "  ok  " : "FALLA"} ${n}` +
    (ok ? "" : `\n        esperado: ${JSON.stringify(esp)}\n        real:     ${JSON.stringify(real)}`));
};

let sig = 1;
function linea(p: Partial<LineaCarga> & { producto_nombre: string }): LineaCarga {
  return {
    id_orden: sig++, estado: "PENDIENTE", estado_normalizado: "PENDIENTE",
    numero_guia: null, transportadora: "ENVIA", ciudad_destino: "BOGOTA",
    linea: 1, producto_id: 1, variacion_id: null, texto_variacion: null,
    unidades_extraidas: null, cantidad: 1, ...p,
  };
}

/* ── Filtro de estados por prefijo ──────────────────────────────────────── */
console.log("── Filtro: el estado debe EMPEZAR por PENDIENTE ──");
for (const e of ["PENDIENTE", "PENDIENTE CONFIRMACION", "PENDIENTE DE PAGO", "PENDIENTES"])
  check(`"${e}" entra`, esEstadoDelReporte(e), true);
for (const e of ["ENTREGADO", "CANCELADO", "EN REPARTO", "GUIA_GENERADA", "DEVOLUCION", "NO PENDIENTE"])
  check(`"${e}" NO entra`, esEstadoDelReporte(e), false);

const mezcla = construirReporteOrdenado([
  linea({ producto_nombre: "Hydra", estado_normalizado: "PENDIENTE" }),
  linea({ producto_nombre: "Waggy pet", estado_normalizado: "PENDIENTE CONFIRMACION" }),
  linea({ producto_nombre: "Focus men", estado_normalizado: "ENTREGADO" }),
  linea({ producto_nombre: "Detox", estado_normalizado: "CANCELADO" }),
  linea({ producto_nombre: "Jogoso", estado_normalizado: "EN REPARTO" }),
]);
check("de 5 órdenes solo entran las 2 PENDIENTE*", mezcla.filas.length, 2);
check("y son las correctas", mezcla.filas.map(f => f.producto).sort(), ["Hydra", "Waggy pet"]);

/* ── TIPO ───────────────────────────────────────────────────────────────── */
console.log("\n── TIPO: NORMAL vs COMBO ──");
const conCombo = construirReporteOrdenado([
  linea({ id_orden: 100, producto_nombre: "Waggy pet", cantidad: 2 }),
  // combo: misma orden, dos productos
  linea({ id_orden: 200, linea: 1, producto_nombre: "Dije Carmen", producto_id: 7, cantidad: 1 }),
  linea({ id_orden: 200, linea: 2, producto_nombre: "Pulsera vancleef", producto_id: 8, cantidad: 3 }),
]);
check("orden de un solo producto → NORMAL",
  conCombo.filas.find(f => f.idOrden === 100)!.tipo, "NORMAL");
const combo = conCombo.filas.find(f => f.idOrden === 200)!;
check("orden con dos productos → COMBO", combo.tipo, "COMBO");
check("el combo va en UNA sola fila", conCombo.filas.length, 2);
check("PRODUCTO lista los componentes con sus cantidades",
  combo.producto, "COMBO · Dije Carmen (1) + Pulsera vancleef (3)");
check("CANTIDAD del combo = 1 pedido a preparar", combo.cantidad, 1);

console.log("\n── Combo con cantidades distintas por componente (regla confirmada por Diego) ──");
// El caso puntual que Diego pidió cubrir: 3 Hydra + 2 Waggy pet en una sola
// orden. En los datos reales de Dropi los únicos dos combos que existen son
// 1+1, así que este patrón (cantidades > 1 y distintas entre componentes)
// nunca se había probado. Sigue siendo una sola fila; el detalle de cuántas
// unidades va de cada producto queda en PRODUCTO, no se pierde.
const combo3y2 = construirReporteOrdenado([
  linea({ id_orden: 300, linea: 1, producto_nombre: "Hydra", producto_id: 1, cantidad: 3 }),
  linea({ id_orden: 300, linea: 2, producto_nombre: "Waggy pet", producto_id: 2, cantidad: 2 }),
]);
const fila3y2 = combo3y2.filas[0];
check("una sola fila para la orden", combo3y2.filas.length, 1);
check("TIPO COMBO", fila3y2.tipo, "COMBO");
check("PRODUCTO: 'Hydra (3) + Waggy pet (2)', no '(1) + (1)'",
  fila3y2.producto, "COMBO · Hydra (3) + Waggy pet (2)");
check("CANTIDAD sigue en 1: la fila es un pedido, no una suma de unidades",
  fila3y2.cantidad, 1);
check("el conteo por producto refleja 3 y 2 — no 1 y 1",
  combo3y2.conteoPorProducto,
  [
    { producto: "Hydra", pedidos: 1, unidades: 3 },
    { producto: "Waggy pet", pedidos: 1, unidades: 2 },
  ]);
check("las unidades totales del reporte son 3+2=5, no 2 (una por componente)",
  combo3y2.totalUnidades, 5);

console.log("\n── El combo se ancla al PRIMER producto que contiene ──");
// "Pulsera dubai" es alfabéticamente anterior, pero viene en linea 2:
// el combo debe ordenarse bajo "Pulsera vancleef" (linea 1), como FulfillPro.
const ancla = construirReporteOrdenado([
  linea({ id_orden: 1, producto_nombre: "Aaa producto" }),
  linea({ id_orden: 2, linea: 1, producto_nombre: "Pulsera vancleef", producto_id: 8 }),
  linea({ id_orden: 2, linea: 2, producto_nombre: "Pulsera dubai", producto_id: 9 }),
  linea({ id_orden: 3, producto_nombre: "Zzz producto" }),
]);
check("el combo queda entre Aaa y Zzz (no primero por 'Pulsera dubai')",
  ancla.filas.map(f => f.tipo), ["NORMAL", "COMBO", "NORMAL"]);
check("anclado a la línea 1",
  ancla.filas[1].producto, "COMBO · Pulsera vancleef (1) + Pulsera dubai (1)");

/* ── Orden ──────────────────────────────────────────────────────────────── */
console.log("\n── Orden: producto A→Z ──");
const az = construirReporteOrdenado([
  linea({ producto_nombre: "Waggy pet" }),
  linea({ producto_nombre: "detox hepático" }),
  linea({ producto_nombre: "Hydra" }),
  linea({ producto_nombre: "Álvaro" }),
]);
check("alfabético, ignorando mayúsculas y tildes",
  az.filas.map(f => f.producto), ["Álvaro", "detox hepático", "Hydra", "Waggy pet"]);

console.log("\n── Orden: variaciones NUMÉRICAS, no alfabéticas ──");
const v = construirReporteOrdenado([
  linea({ producto_nombre: "Hydra", producto_id: 1, variacion_id: 3, texto_variacion: "10 unidades", unidades_extraidas: 10 }),
  linea({ producto_nombre: "Hydra", producto_id: 1, variacion_id: 1, texto_variacion: "1 unidad", unidades_extraidas: 1 }),
  linea({ producto_nombre: "Hydra", producto_id: 1, variacion_id: 2, texto_variacion: "2 unidades", unidades_extraidas: 2 }),
]);
check("1, 2, 10 — no 1, 10, 2",
  v.filas.map(f => f.variacion), ["1 unidad", "2 unidades", "10 unidades"]);

console.log("\n── Orden: dentro de la variación, cantidad ASCENDENTE ──");
const c = construirReporteOrdenado([
  linea({ producto_nombre: "Hydra", variacion_id: 1, texto_variacion: "1 unidad", unidades_extraidas: 1, cantidad: 3 }),
  linea({ producto_nombre: "Hydra", variacion_id: 1, texto_variacion: "1 unidad", unidades_extraidas: 1, cantidad: 1 }),
  linea({ producto_nombre: "Hydra", variacion_id: 1, texto_variacion: "1 unidad", unidades_extraidas: 1, cantidad: 2 }),
]);
check("1, 2, 3", c.filas.map(f => f.cantidad), [1, 2, 3]);

console.log("\n── Orden: sin variación antes que con variación ──");
const mixto = construirReporteOrdenado([
  linea({ producto_nombre: "Hydra", variacion_id: 1, texto_variacion: "2 unidades", unidades_extraidas: 2 }),
  linea({ producto_nombre: "Hydra", variacion_id: null, texto_variacion: null }),
]);
check("primero la fila sin variación", mixto.filas.map(f => f.variacion), ["—", "2 unidades"]);

/* ── Columnas nuevas ────────────────────────────────────────────────────── */
console.log("\n── Columnas nuevas del Sprint 2 ──");
const col = construirReporteOrdenado([
  linea({ producto_nombre: "Hydra", transportadora: "INTERRAPIDISIMO", ciudad_destino: "CARTAGENA", numero_guia: null }),
]);
check("TRANSPORTADORA", col.filas[0].transportadora, "INTERRAPIDISIMO");
check("CIUDAD DESTINO", col.filas[0].ciudadDestino, "CARTAGENA");
check("N GUIA null (las PENDIENTE nunca tienen guía)", col.filas[0].numeroGuia, null);

const sinDatos = construirReporteOrdenado([
  linea({ producto_nombre: "Hydra", transportadora: null, ciudad_destino: null }),
]);
check("toleran venir vacías",
  [sinDatos.filas[0].transportadora, sinDatos.filas[0].ciudadDestino], [null, null]);

/* ── Conteo ─────────────────────────────────────────────────────────────── */
console.log("\n── Conteo por producto ──");
const conteo = construirReporteOrdenado([
  linea({ id_orden: 1, producto_nombre: "Hydra", cantidad: 2 }),
  linea({ id_orden: 2, producto_nombre: "Hydra", cantidad: 3 }),
  linea({ id_orden: 3, producto_nombre: "Waggy pet", cantidad: 1 }),
  // combo: cada componente se cuenta por separado
  linea({ id_orden: 4, linea: 1, producto_nombre: "Hydra", producto_id: 1, cantidad: 1 }),
  linea({ id_orden: 4, linea: 2, producto_nombre: "Waggy pet", producto_id: 2, cantidad: 4 }),
]);
check("Hydra: 3 pedidos, 6 unidades",
  conteo.conteoPorProducto.find(x => x.producto === "Hydra"), { producto: "Hydra", pedidos: 3, unidades: 6 });
check("Waggy pet: 2 pedidos, 5 unidades",
  conteo.conteoPorProducto.find(x => x.producto === "Waggy pet"), { producto: "Waggy pet", pedidos: 2, unidades: 5 });
check("total de pedidos = órdenes distintas", conteo.totalPedidos, 4);
check("total de unidades", conteo.totalUnidades, 11);
check("el conteo va A→Z", conteo.conteoPorProducto.map(x => x.producto), ["Hydra", "Waggy pet"]);

console.log("\n── Carga sin órdenes por despachar ──");
const vacio = construirReporteOrdenado([
  linea({ producto_nombre: "Hydra", estado_normalizado: "ENTREGADO" }),
]);
check("reporte vacío, sin reventar", [vacio.filas.length, vacio.totalPedidos, vacio.totalUnidades], [0, 0, 0]);

console.log(`\n${fallos === 0 ? "REPORTE ORDENADO CORRECTO" : `${fallos} FALLOS`}`);
process.exit(fallos ? 1 : 0);
