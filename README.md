# FULLEGACY

Sistema de reportes de pedidos a partir de los exports de Excel de Dropi.
Cliente: Diego Perea (fulfillment).

**Estado: Sprint 1 — ingesta.** Ya se pueden cargar los Excel de Dropi y quedan
guardadas las órdenes, productos y variaciones. El Reporte Ordenado, el
historial mensual y el dashboard son de sprints posteriores.

## Stack

| Pieza          | Elección                                   |
| -------------- | ------------------------------------------ |
| Framework      | Next.js 16 (App Router, TypeScript)        |
| Estilos        | Tailwind CSS v4                            |
| Base de datos  | Supabase (PostgreSQL)                      |
| Autenticación  | Supabase Auth + Google OAuth               |
| Hosting        | Vercel (subdominio gratuito)               |
| Keep-alive     | Vercel Cron → `/api/cron/keep-alive`       |
| Lectura Excel  | ExcelJS                                    |

## Puesta en marcha

### 1. Supabase

1. Crear el proyecto en [supabase.com](https://supabase.com).
2. Aplicar las migraciones de `supabase/migrations/` **en orden**. Con el CLI:

   ```bash
   npx supabase link --project-ref <project-ref>
   npx supabase db push
   ```

   O pegando cada archivo en el **SQL Editor** del dashboard, en este orden:
   1. `20260825120000_esquema_inicial.sql`
   2. `20260825120100_restriccion_acceso.sql`
   3. `20260826090000_ordenes_numero_guia.sql`
   4. `20260826090100_procesar_carga.sql`

3. **Authentication → Providers → Google**: activarlo y pegar el Client ID y el
   Client Secret de Google Cloud.
4. **Authentication → URL Configuration**:
   - *Site URL*: `https://<tu-proyecto>.vercel.app`
   - *Redirect URLs*: agregar `http://localhost:3000/auth/callback` y
     `https://<tu-proyecto>.vercel.app/auth/callback`

### 2. Google Cloud Console

En *APIs & Services → Credentials → OAuth 2.0 Client ID* (tipo *Web application*),
agregar como **Authorized redirect URI**:

```
https://<project-ref>.supabase.co/auth/v1/callback
```

(Es la URL de Supabase, no la de Vercel. Supabase reenvía después a `/auth/callback`.)

### 3. Variables de entorno

```bash
cp .env.example .env.local
```

Rellenar los valores. Ver `.env.example` para el detalle de cada una.

### 4. Local

```bash
npm install
npm run dev
```

### 5. Vercel

1. Importar el repositorio.
2. Cargar las mismas variables de `.env.local` en *Settings → Environment Variables*
   (`NEXT_PUBLIC_SITE_URL` debe apuntar al dominio de Vercel, no a localhost).
3. `CRON_SECRET` lo consume Vercel Cron automáticamente: al definirlo como
   variable de entorno, Vercel lo envía en el header `Authorization` de cada
   invocación del cron declarado en `vercel.json`.

## Control de acceso

El sistema es de **un solo usuario**. No hay registro público. Hay tres capas:

1. **Base de datos** — un trigger `BEFORE INSERT` sobre `auth.users` aborta la
   creación de cualquier cuenta cuyo correo no esté en `public.usuarios_autorizados`.
   Aunque alguien complete el flujo de Google con otra cuenta, no queda usuario creado.
2. **Callback OAuth** — `/auth/callback` verifica el correo y cierra la sesión si
   no coincide.
3. **Proxy** — `src/proxy.ts` bloquea toda ruta que no sea pública.

`public.usuarios_autorizados` es la **única fuente de verdad**: la consultan
tanto el trigger de la base de datos como la app (`src/lib/auth/autorizacion.ts`,
con la service_role key, porque la tabla tiene RLS y ninguna policy de lectura).
Agregar o quitar un acceso es un INSERT/DELETE en esa tabla — sin redeploy y sin
variables de entorno. La app cachea la lista 30 s, salvo en el login, que siempre
la relee para que un correo recién agregado pueda entrar de inmediato.

## Ingesta de archivos

Diego sube uno o varios `.xlsx` en `/cargas`. Por cada archivo:

1. **Parseo** — se leen solo las 11 columnas relevantes de las 54 del export.
   Si falta una columna crítica (`ID`, `ESTATUS`, `PRODUCTO ID`, `VARIACION ID`)
   el archivo se rechaza completo, sin procesar ninguna fila.
2. **Filas con error** — una fila con datos inconsistentes se registra y se
   omite, pero no tumba el archivo. Aparecen en el resumen con su número de fila.
3. **Guardado** — todo el archivo se persiste en una sola llamada a
   `procesar_carga()`, que Postgres ejecuta como una transacción. O queda el
   archivo completo, o no queda nada.

**Control de duplicados:** si el `ID` de una orden ya existe, esa orden se
omite entera — no se reinserta ni se actualiza, y no se tocan sus líneas.
Subir el mismo archivo dos veces es inofensivo.

**Combos:** una orden que ocupa varias filas del Excel se guarda como varias
filas de `orden_productos` con el mismo `orden_id`.

## Pruebas

```bash
npm test
```

Levanta un Postgres real en WASM ([PGlite](https://pglite.dev)), aplica las
migraciones del repo y verifica la ingesta de punta a punta contra un `.xlsx`
generado con la forma real del export de Dropi. No necesita conexión a Supabase
ni credenciales.

- `pruebas/sql.test.mjs` — comportamiento de `procesar_carga()`: duplicados,
  combos, variación repetida, atomicidad.
- `pruebas/e2e.test.mts` — parser → agrupador → base de datos.

## Modelo de datos

```
productos (id = PRODUCTO_ID de Dropi)
   └── producto_variaciones (id = VARIACION_ID de Dropi)
          └── orden_productos (cantidad)   ──►   ordenes (id_orden = ID de Dropi)
```

Los IDs de Dropi son la clave primaria directa, lo que hace que el control de
duplicados entre cargas sea un `on conflict do nothing`.

`orden_productos` admite varias filas por orden: así se representan los combos,
y cada producto que los compone se cuenta individualmente en los reportes.

**Zona horaria:** las fechas del Excel no traen zona. Se interpretan como hora
de pared de América/Bogotá (UTC-5) y se guardan como `timestamptz`. Esto importa
para el historial mensual, que agrupa por día.

## Verificación

```bash
npx tsc --noEmit
npx eslint .
npm test
npm run build
```
# FULLEGACY
