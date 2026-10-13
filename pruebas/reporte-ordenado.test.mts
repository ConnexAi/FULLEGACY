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
// Acá la orden combo es la única de la carga: ninguno de los dos productos
// tiene pedidos normales, así que ninguno tiene fila propia. El detalle de
// cuántas unidades va de cada uno se lee en el nombre de la fila del combo.
check("el conteo es una sola fila de combo, con las cantidades a la vista",
  combo3y2.conteoPorProducto,
  [
    {
      tipo: "COMBO",
      producto: "COMBO · Hydra (3) + Waggy pet (2)",
      pedidos: 1,
      unidades: null,
    },
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

/* ══════════════════════════════════════════════════════════════════════════
   Conteo por producto
   ──────────────────────────────────────────────────────────────────────────
   La regla vieja contaba un pedido en la fila de cada producto del combo, así
   que la columna PEDIDOS sumaba más que el Total (78 órdenes se veían como 79
   pedidos en la carga del 13/10). Ahora cada orden cuenta en una sola fila.
   ══════════════════════════════════════════════════════════════════════════ */

/** Lo que Diego verifica a ojo: la columna PEDIDOS tiene que dar el Total. */
const sumaPedidos = (r: ReturnType<typeof construirReporteOrdenado>) =>
  r.conteoPorProducto.reduce((n, f) => n + f.pedidos, 0);

/** La columna UNIDADES, que NO siempre da el Total (ver el caso del Dije). */
const sumaUnidades = (r: ReturnType<typeof construirReporteOrdenado>) =>
  r.conteoPorProducto.reduce((n, f) => n + (f.unidades ?? 0), 0);

console.log("\n── Conteo: productos con normales + combos ──");
const conteo = construirReporteOrdenado([
  linea({ id_orden: 1, producto_nombre: "Hydra", cantidad: 2 }),
  linea({ id_orden: 2, producto_nombre: "Hydra", cantidad: 3 }),
  linea({ id_orden: 3, producto_nombre: "Waggy pet", cantidad: 1 }),
  linea({ id_orden: 4, linea: 1, producto_nombre: "Hydra", producto_id: 1, cantidad: 1 }),
  linea({ id_orden: 4, linea: 2, producto_nombre: "Waggy pet", producto_id: 2, cantidad: 4 }),
]);
check("Hydra: 2 pedidos normales, pero las 6 unidades (incluye la del combo)",
  conteo.conteoPorProducto.find(x => x.producto === "Hydra"),
  { tipo: "PRODUCTO", producto: "Hydra", pedidos: 2, unidades: 6 });
check("Waggy pet: 1 pedido normal, 5 unidades (1 + las 4 del combo)",
  conteo.conteoPorProducto.find(x => x.producto === "Waggy pet"),
  { tipo: "PRODUCTO", producto: "Waggy pet", pedidos: 1, unidades: 5 });
check("el combo tiene su propia fila, con UNIDADES vacío",
  conteo.conteoPorProducto.find(x => x.tipo === "COMBO"),
  { tipo: "COMBO", producto: "COMBO · Hydra (1) + Waggy pet (4)", pedidos: 1, unidades: null });
check("los combos van después de los productos",
  conteo.conteoPorProducto.map(x => x.tipo), ["PRODUCTO", "PRODUCTO", "COMBO"]);
check("total de pedidos = órdenes distintas", conteo.totalPedidos, 4);
check("total de unidades", conteo.totalUnidades, 11);
// El descuadre que motivó el cambio: antes esto daba 5 contra 4.
check("la columna PEDIDOS suma exactamente el Total", sumaPedidos(conteo), conteo.totalPedidos);
check("y acá UNIDADES también, porque los dos productos tienen fila",
  sumaUnidades(conteo), conteo.totalUnidades);

/* ── El ejemplo real que pidió Diego ───────────────────────────────────── */
console.log("\n── El ejemplo completo: 42 pedidos, 45 unidades, el Dije sin fila ──");
const real = construirReporteOrdenado([
  ...Array.from({ length: 30 }, () =>
    linea({ producto_nombre: "AW chocolate", producto_id: 1 })),
  ...Array.from({ length: 4 }, () =>
    linea({ producto_nombre: "AW 839 azul", producto_id: 2 })),
  ...Array.from({ length: 5 }, () =>
    linea({ producto_nombre: "Cadena militar rosada", producto_id: 3 })),
  // 2 combos iguales: AW chocolate (1) + AW 839 azul (1)
  ...[901, 902].flatMap((id) => [
    linea({ id_orden: id, linea: 1, producto_nombre: "AW chocolate", producto_id: 1 }),
    linea({ id_orden: id, linea: 2, producto_nombre: "AW 839 azul", producto_id: 2 }),
  ]),
  // 1 combo con un producto que NO tiene ningún pedido normal
  linea({ id_orden: 903, linea: 1, producto_nombre: "Dije virgen guadalupe", producto_id: 4 }),
  linea({ id_orden: 903, linea: 2, producto_nombre: "Cadena militar rosada", producto_id: 3 }),
]);

check("la tabla completa, fila por fila",
  real.conteoPorProducto,
  [
    { tipo: "PRODUCTO", producto: "AW 839 azul", pedidos: 4, unidades: 6 },
    { tipo: "PRODUCTO", producto: "AW chocolate", pedidos: 30, unidades: 32 },
    { tipo: "PRODUCTO", producto: "Cadena militar rosada", pedidos: 5, unidades: 6 },
    { tipo: "COMBO", producto: "COMBO · AW chocolate (1) + AW 839 azul (1)", pedidos: 2, unidades: null },
    { tipo: "COMBO", producto: "COMBO · Dije virgen guadalupe (1) + Cadena militar rosada (1)", pedidos: 1, unidades: null },
  ]);
check("el Dije NO tiene fila propia: solo aparece dentro del combo",
  real.conteoPorProducto.some(f => f.producto === "Dije virgen guadalupe"), false);
check("Total PEDIDOS = 42", real.totalPedidos, 42);
check("Total UNIDADES = 45", real.totalUnidades, 45);
check("la columna PEDIDOS suma 42, igual al Total", sumaPedidos(real), 42);
// Acá está la diferencia legítima: la unidad del Dije está en el Total pero
// en ninguna fila, porque el Dije no tiene fila.
check("la columna UNIDADES suma 44: el Total es mayor por la unidad del Dije",
  [sumaUnidades(real), real.totalUnidades - sumaUnidades(real)], [44, 1]);

/* ── Combo 3+2 de productos que SÍ tienen normales ────────────────────── */
console.log("\n── Combo 3 + 2 de productos que también tienen pedidos normales ──");
const mixto3y2 = construirReporteOrdenado([
  linea({ id_orden: 10, producto_nombre: "Hydra", producto_id: 1, cantidad: 1 }),
  linea({ id_orden: 11, producto_nombre: "Waggy pet", producto_id: 2, cantidad: 2 }),
  linea({ id_orden: 12, linea: 1, producto_nombre: "Hydra", producto_id: 1, cantidad: 3 }),
  linea({ id_orden: 12, linea: 2, producto_nombre: "Waggy pet", producto_id: 2, cantidad: 2 }),
]);
check("las dos filas de producto y la del combo",
  mixto3y2.conteoPorProducto,
  [
    { tipo: "PRODUCTO", producto: "Hydra", pedidos: 1, unidades: 4 },
    { tipo: "PRODUCTO", producto: "Waggy pet", pedidos: 1, unidades: 4 },
    { tipo: "COMBO", producto: "COMBO · Hydra (3) + Waggy pet (2)", pedidos: 1, unidades: null },
  ]);
check("Total: 3 pedidos, 8 unidades", [mixto3y2.totalPedidos, mixto3y2.totalUnidades], [3, 8]);
check("la columna PEDIDOS suma el Total", sumaPedidos(mixto3y2), mixto3y2.totalPedidos);
check("y UNIDADES también: los dos productos tienen fila",
  sumaUnidades(mixto3y2), mixto3y2.totalUnidades);

/* ── Mismos productos, cantidades distintas = dos tipos ───────────────── */
console.log("\n── Dos combos con los mismos productos y distintas cantidades ──");
const dosTipos = construirReporteOrdenado([
  linea({ id_orden: 20, linea: 1, producto_nombre: "AW chocolate", producto_id: 1, cantidad: 1 }),
  linea({ id_orden: 20, linea: 2, producto_nombre: "AW 839 azul", producto_id: 2, cantidad: 1 }),
  linea({ id_orden: 21, linea: 1, producto_nombre: "AW chocolate", producto_id: 1, cantidad: 2 }),
  linea({ id_orden: 21, linea: 2, producto_nombre: "AW 839 azul", producto_id: 2, cantidad: 1 }),
]);
check("son DOS tipos de combo, no uno con 2 pedidos",
  dosTipos.conteoPorProducto,
  [
    { tipo: "COMBO", producto: "COMBO · AW chocolate (1) + AW 839 azul (1)", pedidos: 1, unidades: null },
    { tipo: "COMBO", producto: "COMBO · AW chocolate (2) + AW 839 azul (1)", pedidos: 1, unidades: null },
  ]);
check("ningún producto tiene fila: ninguno tiene pedidos normales",
  dosTipos.conteoPorProducto.every(f => f.tipo === "COMBO"), true);
check("la columna PEDIDOS suma el Total", sumaPedidos(dosTipos), dosTipos.totalPedidos);

console.log("\n── El tipo de combo no depende del orden de las líneas ──");
// Mismos productos y cantidades, listados al revés en el archivo: es el mismo
// tipo. El nombre se toma de la orden más antigua, para que no dependa de en
// qué orden lleguen las filas de la consulta.
const mismoTipo = construirReporteOrdenado([
  linea({ id_orden: 30, linea: 1, producto_nombre: "AW chocolate", producto_id: 1 }),
  linea({ id_orden: 30, linea: 2, producto_nombre: "AW 839 azul", producto_id: 2 }),
  linea({ id_orden: 31, linea: 1, producto_nombre: "AW 839 azul", producto_id: 2 }),
  linea({ id_orden: 31, linea: 2, producto_nombre: "AW chocolate", producto_id: 1 }),
]);
check("una sola fila de combo con 2 pedidos",
  mismoTipo.conteoPorProducto,
  [
    { tipo: "COMBO", producto: "COMBO · AW chocolate (1) + AW 839 azul (1)", pedidos: 2, unidades: null },
  ]);

/* ── Carga sin combos ──────────────────────────────────────────────────── */
console.log("\n── Carga sin combos: ninguna fila de combo ──");
const sinCombos = construirReporteOrdenado([
  linea({ id_orden: 40, producto_nombre: "Hydra", cantidad: 2 }),
  linea({ id_orden: 41, producto_nombre: "Hydra", cantidad: 3 }),
  linea({ id_orden: 42, producto_nombre: "Waggy pet", cantidad: 1 }),
]);
check("solo filas de producto, A→Z",
  sinCombos.conteoPorProducto,
  [
    { tipo: "PRODUCTO", producto: "Hydra", pedidos: 2, unidades: 5 },
    { tipo: "PRODUCTO", producto: "Waggy pet", pedidos: 1, unidades: 1 },
  ]);
check("ninguna fila de combo", sinCombos.conteoPorProducto.some(f => f.tipo === "COMBO"), false);
check("PEDIDOS suma el Total", sumaPedidos(sinCombos), sinCombos.totalPedidos);
check("y UNIDADES también", sumaUnidades(sinCombos), sinCombos.totalUnidades);
check("Total: 3 pedidos, 6 unidades",
  [sinCombos.totalPedidos, sinCombos.totalUnidades], [3, 6]);

console.log("\n── Carga sin órdenes por despachar ──");
const vacio = construirReporteOrdenado([
  linea({ producto_nombre: "Hydra", estado_normalizado: "ENTREGADO" }),
]);
check("reporte vacío, sin reventar", [vacio.filas.length, vacio.totalPedidos, vacio.totalUnidades], [0, 0, 0]);

console.log(`\n${fallos === 0 ? "REPORTE ORDENADO CORRECTO" : `${fallos} FALLOS`}`);
process.exit(fallos ? 1 : 0);
