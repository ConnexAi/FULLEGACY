-- ============================================================================
-- FULLEGACY — Restricción de acceso a un único correo
--
-- No hay registro público. El sistema es de un solo usuario (Diego).
--
-- La restricción se aplica en la capa más profunda posible: un trigger
-- BEFORE INSERT sobre auth.users. Aunque alguien complete el flujo de Google
-- OAuth con otra cuenta, la creación del usuario falla en la base de datos y
-- no queda ninguna cuenta creada.
--
-- La app además valida el correo en el callback y en el middleware, pero esa
-- es la segunda línea de defensa, no la única.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Lista blanca de correos. Tabla (y no una constante) para poder cambiar o
-- agregar el correo sin escribir una nueva migración.
-- ---------------------------------------------------------------------------
create table if not exists public.usuarios_autorizados (
  correo     text primary key check (correo = lower(correo)),
  nota       text,
  creado_en  timestamptz not null default now()
);

comment on table public.usuarios_autorizados is
  'Lista blanca de correos que pueden autenticarse. El trigger sobre auth.users la consulta.';

insert into public.usuarios_autorizados (correo, nota)
values ('diegoperea093@gmail.com', 'Diego Perea — único usuario del sistema')
on conflict (correo) do nothing;

-- Nadie puede leer ni modificar la lista blanca desde el cliente.
-- Solo la service_role key (que salta RLS) y el trigger (security definer).
alter table public.usuarios_autorizados enable row level security;


-- ---------------------------------------------------------------------------
-- Trigger de bloqueo sobre auth.users
-- ---------------------------------------------------------------------------
create or replace function public.bloquear_correos_no_autorizados()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is null
     or not exists (
       select 1
       from public.usuarios_autorizados ua
       where ua.correo = lower(new.email)
     )
  then
    raise exception
      'Acceso no autorizado para %. Este sistema no admite registro publico.',
      coalesce(new.email, '(sin correo)')
      using errcode = '42501';  -- insufficient_privilege
  end if;

  return new;
end;
$$;

comment on function public.bloquear_correos_no_autorizados() is
  'Impide crear cuentas en auth.users con un correo fuera de public.usuarios_autorizados.';

drop trigger if exists bloquear_correos_no_autorizados_trg on auth.users;

create trigger bloquear_correos_no_autorizados_trg
  before insert on auth.users
  for each row
  execute function public.bloquear_correos_no_autorizados();
