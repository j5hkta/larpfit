-- =============================================================================
-- Larpfit — 00004_game_modes.sql
-- Dos disciplinas: 'aesthetics' (V-taper, 15 s) y 'performance' (planchas, 30 s).
-- Solo se emparejan jugadores que coincidan en país Y en modo de juego.
--
-- Ejecutar en el SQL Editor del dashboard de Supabase, después de 00003.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. COLUMNA game_mode
-- -----------------------------------------------------------------------------
-- El default permite añadirla como NOT NULL sobre las filas que ya existen:
-- todo lo jugado hasta ahora fue estética.

alter table public.queue
  add column if not exists game_mode text not null default 'aesthetics';

alter table public.matches
  add column if not exists game_mode text not null default 'aesthetics';

do $$
begin
  alter table public.queue
    add constraint queue_game_mode_check
    check (game_mode in ('aesthetics', 'performance'));
exception when duplicate_object then null;
end
$$;

do $$
begin
  alter table public.matches
    add constraint matches_game_mode_check
    check (game_mode in ('aesthetics', 'performance'));
exception when duplicate_object then null;
end
$$;

-- La cola ahora se busca por país + modo: el índice tiene que reflejarlo o
-- cada emparejamiento hará un seq scan.
drop index if exists queue_country_joined_at_idx;
create index if not exists queue_country_mode_joined_at_idx
  on public.queue (country, game_mode, joined_at);

-- -----------------------------------------------------------------------------
-- 2. RETIRAR LA FIRMA ANTIGUA
-- -----------------------------------------------------------------------------
-- CREATE OR REPLACE con una lista de argumentos distinta NO reemplaza: crea una
-- sobrecarga. Si dejáramos viva join_queue_or_match(text), un cliente sin
-- actualizar seguiría creando duelos sin modo y emparejando entre disciplinas.

drop function if exists public.join_queue_or_match(text);

-- -----------------------------------------------------------------------------
-- 3. join_queue_or_match CON MODO DE JUEGO
-- -----------------------------------------------------------------------------
-- Se reproduce el cuerpo completo de 00003: cierre de duelos abandonados,
-- reconexión al duelo activo, barrido de colas fantasma y FOR UPDATE SKIP
-- LOCKED. Perder cualquiera de esas piezas reabriría los bugs ya resueltos.

create or replace function public.join_queue_or_match(
  p_country   text,
  p_game_mode text
)
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

  -- El modo llega del cliente: se valida aquí, no se confía en la UI.
  if p_game_mode is null or p_game_mode not in ('aesthetics', 'performance') then
    raise exception 'Modo de juego inválido: %', p_game_mode using errcode = '22023';
  end if;

  -- (00003) Cerrar duelos colgados antes de mirar si hay uno activo.
  perform public.close_abandoned_matches(v_user_id);

  -- Reconexión: si sigue en un duelo activo de verdad, lo devolvemos.
  -- No se filtra por modo a propósito: si refresca la página en mitad de un
  -- duelo, debe volver a ESE duelo, sea de la disciplina que sea.
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

  update public.profiles
     set country = p_country
   where id = v_user_id;

  -- Nunca emparejarse consigo mismo.
  delete from public.queue where profile_id = v_user_id;

  -- (00002) Barrido de colas fantasma.
  delete from public.queue
   where joined_at < now() - interval '30 seconds';

  -- Rival del MISMO país y del MISMO modo. SKIP LOCKED evita que dos llamadas
  -- concurrentes se lleven la misma fila.
  select q.profile_id
    into v_opponent_id
    from public.queue q
   where q.country = p_country
     and q.game_mode = p_game_mode
     and q.profile_id <> v_user_id
   order by q.joined_at
   limit 1
     for update skip locked;

  if v_opponent_id is not null then
    delete from public.queue where profile_id = v_opponent_id;

    insert into public.matches (player1_id, player2_id, status, game_mode)
    values (v_opponent_id, v_user_id, 'active', p_game_mode)
    returning id into v_match_id;

    return v_match_id;
  end if;

  -- Nadie esperando en esta disciplina: entramos a la cola.
  insert into public.queue (profile_id, country, game_mode)
  values (v_user_id, p_country, p_game_mode)
  on conflict (profile_id)
    do update set country   = excluded.country,
                  game_mode = excluded.game_mode,
                  joined_at = now();

  return null;
end;
$$;

revoke all on function public.join_queue_or_match(text, text) from public, anon;
grant execute on function public.join_queue_or_match(text, text) to authenticated;
