-- =============================================================================
-- Larpfit — 00001_initial_schema.sql
-- Esquema inicial: perfiles, cola de emparejamiento, matches, RLS y RPC atómica.
-- Ejecutar en el SQL Editor del dashboard de Supabase (o vía `supabase db push`).
-- Es idempotente: se puede volver a ejecutar sin romper nada.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. TABLAS
-- -----------------------------------------------------------------------------

-- profiles: 1:1 con auth.users. Nunca se crea desde el cliente (ver trigger §5).
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    text not null unique,
  country     text,
  created_at  timestamptz not null default now(),
  constraint username_length check (char_length(username) between 3 and 20)
);

-- queue: cola de emparejamiento. Un usuario solo puede estar una vez en la cola.
create table if not exists public.queue (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null unique references public.profiles (id) on delete cascade,
  country     text not null,
  joined_at   timestamptz not null default now()
);

-- matches: duelos 1v1. El resultado (winner_id) solo lo escribe el servidor.
create table if not exists public.matches (
  id          uuid primary key default gen_random_uuid(),
  player1_id  uuid not null references public.profiles (id) on delete cascade,
  player2_id  uuid not null references public.profiles (id) on delete cascade,
  status      text not null default 'active' check (status in ('active', 'completed')),
  winner_id   uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint different_players check (player1_id <> player2_id),
  constraint winner_is_a_player check (
    winner_id is null or winner_id in (player1_id, player2_id)
  )
);

-- Índices para las consultas calientes del matchmaking.
create index if not exists queue_country_joined_at_idx
  on public.queue (country, joined_at);
create index if not exists matches_player1_idx on public.matches (player1_id);
create index if not exists matches_player2_idx on public.matches (player2_id);
create index if not exists matches_status_idx  on public.matches (status);

-- -----------------------------------------------------------------------------
-- 2. ROW LEVEL SECURITY — activado en TODAS las tablas, sin excepciones.
-- -----------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.queue    enable row level security;
alter table public.matches  enable row level security;

-- --- profiles ---------------------------------------------------------------

-- Los perfiles son legibles por cualquier usuario autenticado: hace falta para
-- mostrar el nombre del oponente en la arena.
drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated"
  on public.profiles for select
  to authenticated
  using (true);

-- Un usuario SOLO puede actualizar su propio perfil.
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Sin política de INSERT ni DELETE: el perfil lo crea el trigger de auth.users
-- y se borra en cascada al eliminar la cuenta.

-- --- queue ------------------------------------------------------------------

-- Cada usuario solo ve su propia entrada en la cola.
drop policy if exists "queue_select_own" on public.queue;
create policy "queue_select_own"
  on public.queue for select
  to authenticated
  using (auth.uid() = profile_id);

-- Puede salir de la cola (cancelar la búsqueda).
drop policy if exists "queue_delete_own" on public.queue;
create policy "queue_delete_own"
  on public.queue for delete
  to authenticated
  using (auth.uid() = profile_id);

-- Sin política de INSERT a propósito: entrar en la cola pasa SIEMPRE por la
-- función join_queue_or_match(), que es quien garantiza la atomicidad.

-- --- matches ----------------------------------------------------------------

-- Un match solo es visible para sus dos participantes.
drop policy if exists "matches_select_participants" on public.matches;
create policy "matches_select_participants"
  on public.matches for select
  to authenticated
  using (auth.uid() = player1_id or auth.uid() = player2_id);

-- Sin políticas de INSERT/UPDATE/DELETE: los matches y el ganador se escriben
-- exclusivamente desde funciones SECURITY DEFINER. Ningún cliente puede
-- declararse ganador.

-- -----------------------------------------------------------------------------
-- 3. FUNCIÓN ATÓMICA DE MATCHMAKING (RPC)
-- -----------------------------------------------------------------------------
-- Busca un rival del mismo país en la cola usando FOR UPDATE SKIP LOCKED para
-- que dos peticiones simultáneas nunca reclamen al mismo oponente.
--   · Si encuentra rival  -> lo saca de la cola, crea el match y devuelve su id.
--   · Si no encuentra     -> mete al usuario en la cola y devuelve NULL.
-- -----------------------------------------------------------------------------

create or replace function public.join_queue_or_match(p_country text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id     uuid := auth.uid();
  v_opponent_id uuid;
  v_match_id    uuid;
begin
  if v_user_id is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;

  if p_country is null or char_length(trim(p_country)) = 0 then
    raise exception 'Debes seleccionar un país' using errcode = '22023';
  end if;

  -- Si ya está en un duelo activo, devolvemos ese en vez de crear otro
  -- (reconexión tras un refresco de página).
  select m.id
    into v_match_id
    from public.matches m
   where m.status = 'active'
     and (m.player1_id = v_user_id or m.player2_id = v_user_id)
   order by m.created_at desc
   limit 1;

  if v_match_id is not null then
    return v_match_id;
  end if;

  -- El país elegido queda registrado en el perfil.
  update public.profiles
     set country = p_country
   where id = v_user_id;

  -- Nunca emparejarse consigo mismo: se limpia cualquier entrada previa propia.
  delete from public.queue where profile_id = v_user_id;

  -- Reclamar un rival del mismo país. SKIP LOCKED evita que dos llamadas
  -- concurrentes bloqueen o se lleven la misma fila.
  select q.profile_id
    into v_opponent_id
    from public.queue q
   where q.country = p_country
     and q.profile_id <> v_user_id
   order by q.joined_at
   limit 1
     for update skip locked;

  if v_opponent_id is not null then
    delete from public.queue where profile_id = v_opponent_id;

    insert into public.matches (player1_id, player2_id, status)
    values (v_opponent_id, v_user_id, 'active')
    returning id into v_match_id;

    return v_match_id;
  end if;

  -- Nadie esperando: entramos a la cola.
  insert into public.queue (profile_id, country)
  values (v_user_id, p_country)
  on conflict (profile_id)
    do update set country = excluded.country, joined_at = now();

  return null;
end;
$$;

revoke all on function public.join_queue_or_match(text) from public, anon;
grant execute on function public.join_queue_or_match(text) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. SALIR DE LA COLA
-- -----------------------------------------------------------------------------

create or replace function public.leave_queue()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.queue where profile_id = auth.uid();
$$;

revoke all on function public.leave_queue() from public, anon;
grant execute on function public.leave_queue() to authenticated;

-- -----------------------------------------------------------------------------
-- 5. TRIGGER: crear el perfil al registrarse
-- -----------------------------------------------------------------------------
-- El username llega en las options.data del signUp de Supabase Auth.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, country)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'username'), ''),
      'player_' || substr(new.id::text, 1, 8)
    ),
    nullif(trim(new.raw_user_meta_data ->> 'country'), '')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- 6. REALTIME
-- -----------------------------------------------------------------------------
-- Necesario para que el cliente reciba el aviso de "match encontrado".
-- RLS sigue aplicando sobre Realtime: cada usuario solo recibe lo suyo.

alter table public.queue   replica identity full;
alter table public.matches replica identity full;

do $$
begin
  begin
    alter publication supabase_realtime add table public.matches;
  exception when duplicate_object then null;
  end;

  begin
    alter publication supabase_realtime add table public.queue;
  exception when duplicate_object then null;
  end;
end
$$;
