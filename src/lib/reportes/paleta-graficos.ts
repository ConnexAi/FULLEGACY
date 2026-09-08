/**
 * Paleta de los gráficos del dashboard.
 *
 * Cada set fue verificado con el validador de la guía de visualización: banda
 * de luminosidad, piso de croma, separación para daltonismo (ΔE OKLab ×100) y
 * contraste contra la superficie, en modo claro y oscuro por separado.
 *
 * El modo oscuro NO es un volteo automático: son pasos propios del mismo tono.
 */

/**
 * Barras: dos series (pedidos y unidades).
 *
 * Claro usa el azul y el dorado de FULLEGACY tal cual (ΔE CVD 27.9, normal
 * 31.1). En oscuro el dorado de marca queda fuera de la banda de luminosidad
 * (L 0.728 contra un techo de 0.67), así que se usa su paso oscuro.
 */
export const SERIES_CLARO = ["#3B6EA5", "#C9A227"] as const;
export const SERIES_OSCURO = ["#3987e5", "#c98500"] as const;

/**
 * Torta: hasta 6 sectores (5 productos + "Otros").
 *
 * Orden fijo, nunca ciclado. "Otros" va en gris de atenuación porque no es una
 * entidad, es el resto.
 */
export const SECTORES_CLARO = [
  "#2a78d6",
  "#eb6834",
  "#1baf7a",
  "#eda100",
  "#e87ba4",
] as const;
export const SECTORES_OSCURO = [
  "#3987e5",
  "#d95926",
  "#199e70",
  "#c98500",
  "#d55181",
] as const;

export const GRIS_OTROS_CLARO = "#9ca3af";
export const GRIS_OTROS_OSCURO = "#6b7280";

/** Máximo de sectores en la torta: pasado eso, los tonos adyacentes se funden. */
export const MAX_SECTORES = 6;

export interface Sector {
  etiqueta: string;
  valor: number;
  /** Índice de color; -1 = "Otros" (gris). */
  indiceColor: number;
}

/**
 * Reduce la lista a como mucho `MAX_SECTORES` sectores, agrupando la cola.
 *
 * Una torta con 21 productos es ilegible: los sectores chicos se vuelven
 * astillas y los colores adyacentes dejan de distinguirse.
 */
export function agruparSectores(
  datos: { etiqueta: string; valor: number }[],
): Sector[] {
  const conValor = datos.filter((d) => d.valor > 0);
  const ordenados = [...conValor].sort((a, b) => b.valor - a.valor);

  if (ordenados.length <= MAX_SECTORES) {
    return ordenados.map((d, i) => ({ ...d, indiceColor: i }));
  }

  const visibles = ordenados.slice(0, MAX_SECTORES - 1);
  const resto = ordenados.slice(MAX_SECTORES - 1);

  return [
    ...visibles.map((d, i) => ({ ...d, indiceColor: i })),
    {
      etiqueta: `Otros (${resto.length})`,
      valor: resto.reduce((n, d) => n + d.valor, 0),
      indiceColor: -1,
    },
  ];
}
