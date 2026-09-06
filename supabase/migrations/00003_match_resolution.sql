-- =============================================================================
-- Larpfit — 00003_match_resolution.sql
-- Cierre del ciclo: puntuaciones, veredicto y fin del "match infinito".
--
-- Ejecutar en el SQL Editor del dashboard de Supabase, después de 00002.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. COLUMNAS DE PUNTUACIÓN
-- -----------------------------------------------------------------------------

alter table public.matches
  add column if not exists player1_score numeric(6, 3),
  add column if not exists player2_score numeric(6, 3);

-- -----------------------------------------------------------------------------
-- 2. ENVÍO DE PUNTUACIÓN Y VEREDICTO
-- -----------------------------------------------------------------------------
-- El cliente calcula su V-taper con MediaPipe, pero el ganador lo decide SIEMPRE
-- el servidor. Un cliente puede mentir sobre su puntuación; no puede declararse
-- ganador ni tocar la del rival.
--
-- El `for update` es imprescindible: los dos cronómetros llegan a cero a la vez,
-- así que ambos jugadores envían su puntuación casi en el mismo instante. Sin el
-- bloqueo, los dos podrían leer "el otro aún no ha puntuado" y el duelo se
-- quedaría activo para siempre.

create or replace function public.submit_score(p_match_id uuid, p_score numeric)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id  uuid := auth.uid();
  v_match    public.matches%rowtype;
  v_winner   uuid;
begin
  if v_user_id is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;

  if p_score is null or p_score <= 0 or p_score > 10 then
    raise exception 'Puntuación fuera de rango' using errcode = '22023';
  end if;

  select * into v_match
    from public.matches
   where id = p_match_id
     for update;

  if not found then
    raise exception 'El duelo no existe' using errcode = 'P0002';
  end if;

  if v_user_id <> v_match.player1_id and v_user_id <> v_match.player2_id then
    raise exception 'No participas en este duelo' using errcode = '42501';
  end if;

  -- Ya resuelto: devolvemos el ganador en vez de reabrirlo.
  if v_match.status = 'completed' then
    return v_match.winner_id;
  end if;

  -- Una sola puntuación por jugador: la primera que llega manda.
  if v_user_id = v_match.player1_id then
    if v_match.player1_score is null then
      update public.matches
         set player1_score = p_score
       where id = p_match_id;
      v_match.player1_score := p_score;
    end if;
  else
    if v_match.player2_score is null then
      update public.matches
         set player2_score = p_score
       where id = p_match_id;
      v_match.player2_score := p_score;
    end if;
  end if;

  -- ¿Están las dos? Entonces hay veredicto.
  if v_match.player1_score is not null and v_match.player2_score is not null then
    v_winner := case
      when v_match.player1_score > v_match.player2_score then v_match.player1_id
      when v_match.player2_score > v_match.player1_score then v_match.player2_id
      else null  -- empate exacto
    end;

    update public.matches
       set winner_id = v_winner,
           status    = 'completed'
     where id = p_match_id;

    return v_winner;
  end if;

  -- Aún falta el rival.
  return null;
end;
$$;

revoke all on function public.submit_score(uuid, numeric) from public, anon;
grant execute on function public.submit_score(uuid, numeric) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. DUELOS ABANDONADOS
-- -----------------------------------------------------------------------------
-- Si un jugador cierra la pestaña a mitad de duelo, su puntuación no llega nunca
-- y el match se queda 'active' para siempre. Como join_queue_or_match devuelve
-- el duelo activo del usuario, este se quedaría atrapado en él de por vida: es
-- exactamente el bug del "match infinito".
--
-- Un duelo dura 15 s; 2 minutos activo significa abandono. Gana quien sí llegó
-- a puntuar.

create or replace function public.close_abandoned_matches(p_user_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.matches
     set status    = 'completed',
         winner_id = case
           when player1_score is not null and player2_score is null then player1_id
           when player2_score is not null and player1_score is null then player2_id
           when player1_score > player2_score then player1_id
           when player2_score > player1_score then player2_id
           else null
         end
   where status = 'active'
     and created_at < now() - interval '2 minutes'
     and (player1_id = p_user_id or player2_id = p_user_id);
$$;

-- Esta función acepta un user_id arbitrario, así que NO puede quedar expuesta:
-- por defecto Postgres concede EXECUTE a PUBLIC y cualquier usuario autenticado
-- podría cerrar los duelos de otro. Solo se usa desde join_queue_or_match, que
-- ya es SECURITY DEFINER.
revoke all on function public.close_abandoned_matches(uuid)
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. join_queue_or_match: ahora barre los duelos abandonados antes de reusar
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

  -- NUEVO EN 00003 — cerrar duelos colgados antes de mirar si hay uno activo.
  perform public.close_abandoned_matches(v_user_id);

  -- Reconexión: si sigue en un duelo activo de verdad, lo devolvemos.
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

  delete from public.queue where profile_id = v_user_id;

  -- Barrido de colas fantasma (00002).
  delete from public.queue
   where joined_at < now() - interval '30 seconds';

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

  insert into public.queue (profile_id, country)
  values (v_user_id, p_country)
  on conflict (profile_id)
    do update set country = excluded.country, joined_at = now();

  return null;
end;
$$;

revoke all on function public.join_queue_or_match(text) from public, anon;
grant execute on function public.join_queue_or_match(text) to authenticated;
