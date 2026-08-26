/** Tipos compartidos por la ingesta de archivos de Dropi. */

/** Una fila válida del Excel, ya tipada. */
export interface FilaDropi {
  /** Número de fila en la hoja (1-based, incluye el encabezado). Para los mensajes de error. */
  fila: number;
  idOrden: number;
  estado: string;
  fechaOrden: Date;
  fechaGuiaGenerada: Date | null;
  numeroGuia: string | null;
  productoId: number;
  productoNombre: string;
  sku: string | null;
  /**
   * NULL cuando el producto no maneja variantes en Dropi. Es el caso de 18 de
   * los 21 productos de Diego: no es un dato faltante, es que no aplica.
   */
  variacionId: number | null;
  textoVariacion: string | null;
  cantidad: number;
}

/** Una fila que no se pudo usar. No detiene el archivo. */
export interface FilaConError {
  fila: number;
  motivo: string;
  /**
   * Id de la orden, si alcanzó a leerse antes de fallar.
   * Permite avisar cuándo una orden se guardó incompleta (le faltó una línea
   * de un combo) en lugar de descartar la fila en silencio.
   */
  idOrden: number | null;
}

/** Resultado de leer un archivo. */
export interface ResultadoParseo {
  filas: FilaDropi[];
  errores: FilaConError[];
  /** Filas de datos leídas, válidas o no. */
  filasLeidas: number;
}

/** Error que aborta el archivo completo (no se procesa nada). */
export class ErrorArchivoDropi extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorArchivoDropi";
  }
}

/** Cuerpo que recibe la función `procesar_carga` en Postgres. */
export interface CargaParaGuardar {
  /** Metadatos del archivo, para la fila de `cargas`. */
  archivo: {
    nombre: string;
    filas_leidas: number;
    filas_con_error: number;
  };
  productos: {
    id: number;
    nombre: string;
    /** Solo para productos sin variantes; si las tiene, el SKU va en la variación. */
    sku: string | null;
  }[];
  variaciones: {
    id: number;
    producto_id: number;
    sku: string | null;
    texto_variacion: string | null;
    unidades_extraidas: number | null;
  }[];
  ordenes: {
    id_orden: number;
    estado: string;
    fecha_orden: string;
    fecha_guia_generada: string | null;
    numero_guia: string | null;
    lineas: {
      producto_id: number;
      variacion_id: number | null;
      cantidad: number;
    }[];
  }[];
}

/** Lo que devuelve `procesar_carga`. */
export interface ResumenGuardado {
  carga_id: number;
  ordenes_nuevas: number;
  ordenes_omitidas: number;
  ids_omitidos: number[];
  lineas_insertadas: number;
  productos_nuevos: number;
  variaciones_nuevas: number;
}

/** Resumen completo de un archivo, para mostrarle a Diego. */
export interface ResumenArchivo {
  archivo: string;
  ok: boolean;
  /** Id de la fila en `cargas`. Presente solo si el archivo se guardó. */
  cargaId?: number;
  /** Presente solo si el archivo se abortó completo. */
  error?: string;
  filasLeidas: number;
  filasConError: number;
  /** Muestra acotada de los errores de fila, para no inundar la pantalla. */
  erroresMuestra: FilaConError[];
  ordenesEnArchivo: number;
  ordenesNuevas: number;
  ordenesOmitidas: number;
  /** Órdenes que se guardaron pero perdieron alguna línea por filas con error. */
  ordenesIncompletas: number;
  lineasInsertadas: number;
  productosNuevos: number;
  variacionesNuevas: number;
}
