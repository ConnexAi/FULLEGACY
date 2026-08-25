# FULLEGACY

Sistema de reportes de pedidos a partir de los exports de Excel de Dropi.
Cliente: Diego Perea (fulfillment).

**Estado: Sprint 0 — solo infraestructura.** No hay parser de Excel, ni reportes,
ni dashboard todavía.

## Stack

| Pieza          | Elección                                   |
| -------------- | ------------------------------------------ |
| Framework      | Next.js 16 (App Router, TypeScript)        |
| Estilos        | Tailwind CSS v4                            |
| Base de datos  | Supabase (PostgreSQL)                      |
| Autenticación  | Supabase Auth + Google OAuth               |
| Hosting        | Vercel (subdominio gratuito)               |
| Keep-alive     | Vercel Cron → `/api/cron/keep-alive`       |

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

Para cambiar el correo autorizado no hace falta redesplegar: basta actualizar la
fila en `public.usuarios_autorizados` (y `NEXT_PUBLIC_ALLOWED_EMAIL` si se quiere
que la app lo refleje también en cliente).

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

## Verificación

```bash
npx tsc --noEmit
npx eslint .
npm run build
```
# FULLEGACY
