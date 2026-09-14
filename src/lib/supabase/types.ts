/**
 * Tipos de la base de datos.
 *
 * Escritos a mano para que coincidan con supabase/migrations/*.sql.
 * Cuando el esquema se estabilice se pueden regenerar con:
 *
 *   npx supabase gen types typescript --project-id <ref> > src/lib/supabase/types.ts
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      productos: {
        Row: {
          id: number;
          nombre: string;
          /** Solo para productos sin variantes. */
          sku: string | null;
          creado_en: string;
        };
        Insert: {
          id: number;
          nombre: string;
          sku?: string | null;
          creado_en?: string;
        };
        Update: {
          id?: number;
          nombre?: string;
          sku?: string | null;
          creado_en?: string;
        };
        Relationships: [];
      };
      cargas: {
        Row: {
          id: number;
          nombre_archivo: string;
          creado_en: string;
          ordenes_nuevas: number;
          ordenes_omitidas: number;
          filas_leidas: number;
          filas_con_error: number;
          productos_nuevos: number;
          variaciones_nuevas: number;
        };
        Insert: {
          id?: never;
          nombre_archivo: string;
          creado_en?: string;
          ordenes_nuevas?: number;
          ordenes_omitidas?: number;
          filas_leidas?: number;
          filas_con_error?: number;
          productos_nuevos?: number;
          variaciones_nuevas?: number;
        };
        Update: {
          id?: never;
          nombre_archivo?: string;
          creado_en?: string;
          ordenes_nuevas?: number;
          ordenes_omitidas?: number;
          filas_leidas?: number;
          filas_con_error?: number;
          productos_nuevos?: number;
          variaciones_nuevas?: number;
        };
        Relationships: [];
      };
      producto_variaciones: {
        Row: {
          id: number;
          producto_id: number;
          sku: string | null;
          texto_variacion: string | null;
          unidades_extraidas: number | null;
          creado_en: string;
        };
        Insert: {
          id: number;
          producto_id: number;
          sku?: string | null;
          texto_variacion?: string | null;
          unidades_extraidas?: number | null;
          creado_en?: string;
        };
        Update: {
          id?: number;
          producto_id?: number;
          sku?: string | null;
          texto_variacion?: string | null;
          unidades_extraidas?: number | null;
          creado_en?: string;
        };
        Relationships: [
          {
            foreignKeyName: "producto_variaciones_producto_id_fkey";
            columns: ["producto_id"];
            referencedRelation: "productos";
            referencedColumns: ["id"];
          },
        ];
      };
      ordenes: {
        Row: {
          id_orden: number;
          estado: string;
          fecha_orden: string;
          fecha_guia_generada: string | null;
          numero_guia: string | null;
          transportadora: string | null;
          ciudad_destino: string | null;
          carga_id: number;
          creado_en: string;
        };
        Insert: {
          id_orden: number;
          estado: string;
          fecha_orden: string;
          fecha_guia_generada?: string | null;
          numero_guia?: string | null;
          transportadora?: string | null;
          ciudad_destino?: string | null;
          carga_id: number;
          creado_en?: string;
        };
        Update: {
          id_orden?: number;
          estado?: string;
          fecha_orden?: string;
          fecha_guia_generada?: string | null;
          numero_guia?: string | null;
          transportadora?: string | null;
          ciudad_destino?: string | null;
          carga_id?: number;
          creado_en?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ordenes_carga_id_fkey";
            columns: ["carga_id"];
            referencedRelation: "cargas";
            referencedColumns: ["id"];
          },
        ];
      };
      orden_productos: {
        Row: {
          id: number;
          orden_id: number;
          producto_id: number;
          /** NULL cuando el producto no maneja variantes. */
          variacion_id: number | null;
          cantidad: number;
          linea: number;
          creado_en: string;
        };
        Insert: {
          id?: never;
          orden_id: number;
          producto_id: number;
          variacion_id?: number | null;
          cantidad: number;
          linea?: number;
          creado_en?: string;
        };
        Update: {
          id?: never;
          orden_id?: number;
          producto_id?: number;
          variacion_id?: number | null;
          cantidad?: number;
          linea?: number;
          creado_en?: string;
        };
        Relationships: [
          {
            foreignKeyName: "orden_productos_orden_id_fkey";
            columns: ["orden_id"];
            referencedRelation: "ordenes";
            referencedColumns: ["id_orden"];
          },
          {
            foreignKeyName: "orden_productos_producto_id_fkey";
            columns: ["producto_id"];
            referencedRelation: "productos";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orden_productos_variacion_producto_fkey";
            columns: ["variacion_id", "producto_id"];
            referencedRelation: "producto_variaciones";
            referencedColumns: ["id", "producto_id"];
          },
        ];
      };
      usuarios_autorizados: {
        Row: {
          correo: string;
          nota: string | null;
          creado_en: string;
        };
        Insert: {
          correo: string;
          nota?: string | null;
          creado_en?: string;
        };
        Update: {
          correo?: string;
          nota?: string | null;
          creado_en?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      /** Orden + línea + producto + variación, aplanado. Base de los reportes. */
      v_lineas_carga: {
        Row: {
          carga_id: number;
          id_orden: number;
          estado: string;
          estado_normalizado: string;
          numero_guia: string | null;
          transportadora: string | null;
          ciudad_destino: string | null;
          fecha_orden: string;
          fecha_guia_generada: string | null;
          linea: number;
          producto_id: number;
          producto_nombre: string;
          variacion_id: number | null;
          texto_variacion: string | null;
          unidades_extraidas: number | null;
          cantidad: number;
        };
        Relationships: [];
      };
    };
    Functions: {
      /** Ingesta transaccional de una carga completa. Ver supabase/migrations/20260826090100_procesar_carga.sql */
      procesar_carga: {
        Args: { p_carga: Json };
        Returns: Json;
      };
      /** Totales por día sin desglose por producto: los combos cuentan una vez. */
      totales_diarios: {
        Args: { p_anio: number; p_mes: number };
        Returns: { dia: number; pedidos: number; unidades: number }[];
      };
      /** Agregación del historial mensual. Ver supabase/migrations/20260908100000_historial_mensual.sql */
      historial_mensual: {
        Args: {
          p_anio: number;
          p_mes: number;
          p_estados_no_completados: string[];
        };
        Returns: {
          producto_id: number;
          dia: number;
          pedidos: number;
          unidades: number;
          no_completados: number;
        }[];
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
}
