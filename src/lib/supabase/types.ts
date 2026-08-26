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
          creado_en: string;
        };
        Insert: {
          id: number;
          nombre: string;
          creado_en?: string;
        };
        Update: {
          id?: number;
          nombre?: string;
          creado_en?: string;
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
          creado_en: string;
        };
        Insert: {
          id_orden: number;
          estado: string;
          fecha_orden: string;
          fecha_guia_generada?: string | null;
          numero_guia?: string | null;
          creado_en?: string;
        };
        Update: {
          id_orden?: number;
          estado?: string;
          fecha_orden?: string;
          fecha_guia_generada?: string | null;
          numero_guia?: string | null;
          creado_en?: string;
        };
        Relationships: [];
      };
      orden_productos: {
        Row: {
          id: number;
          orden_id: number;
          variacion_id: number;
          cantidad: number;
          creado_en: string;
        };
        Insert: {
          id?: never;
          orden_id: number;
          variacion_id: number;
          cantidad: number;
          creado_en?: string;
        };
        Update: {
          id?: never;
          orden_id?: number;
          variacion_id?: number;
          cantidad?: number;
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
            foreignKeyName: "orden_productos_variacion_id_fkey";
            columns: ["variacion_id"];
            referencedRelation: "producto_variaciones";
            referencedColumns: ["id"];
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
    Views: Record<never, never>;
    Functions: {
      /** Ingesta transaccional de una carga completa. Ver supabase/migrations/20260826090100_procesar_carga.sql */
      procesar_carga: {
        Args: { p_carga: Json };
        Returns: Json;
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
}
