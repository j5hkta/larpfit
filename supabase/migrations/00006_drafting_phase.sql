-- =============================================================================
-- Larpfit — 00006_drafting_phase.sql
-- Fase de selección de ejercicio (drafting) para el modo Rendimiento.
--
-- Niveles ('normal' / 'hard') y modalidad misteriosa. Solo se emparejan
-- jugadores que coincidan EXACTAMENTE en país, disciplina, nivel y misterio.
--
-- Ejecutar en el SQL Editor del dashboard, después de 00005. Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. COLUMNAS NUEVAS
-- -----------------------------------------------------------------------------

alter table public.queue
  add column if not exists performance_tier text,
  add column if not exists is_mystery boolean not null default false;

alter table public.matches
  -- El nivel y el misterio también viven en el match: la fila de la cola se
  -- borra al emparejar, y la fase de drafting los necesita después.
  add column if not exists performance_tier   text,
  add column if not exists is_mystery         boolean not null default false,
  -- Las tres cartas repartidas. Las elige el servidor para que ambos jugadores
  -- vean exactamente lo mismo.
  add column if not exists draft_options      text[],
  add column if not exists p1_vote            text,
  add column if not exists p2_vote            text,
  add column if not exists selected_exercise  text;

do $$
begin
  alter table public.queue
    add constraint queue_performance_tier_check
    check (performance_tier is null or performance_tier in ('normal', 'hard'));
exception when duplicate_object then null;
end
$$;

do $$
begin
  alter table public.matches
    add constraint matches_performance_tier_check
    check (performance_tier is null or performance_tier in ('normal', 'hard'));
exception when duplicate_object then null;
end
$$;

-- El nivel y el misterio entran en la búsqueda de rival: el índice debe
-- cubrirlos o cada emparejamiento haría un seq scan.
drop index if exists queue_country_mode_joined_at_idx;
create index if not exists queue_matching_idx
  on public.queue (country, game_mode, performance_tier, is_mystery, joined_at);

-- -----------------------------------------------------------------------------
-- 2. CATÁLOGO DE EJERCICIOS
-- -----------------------------------------------------------------------------
-- Los ids deben mantenerse en paralelo con lib/exercises.ts, que aporta los
-- nombres y descripciones. Aquí solo importa CUÁLES existen, para poder
-- repartir cartas y validar votos sin fiarse del cliente.

create or replace function public.exercise_catalog(p_tier text)
returns text[]
language sql
immutable
set search_path = public
as $$
  select case p_tier
    when 'hard' then array[
      'burpees', 'diamond_pushups', 'knee_jumps',
      'pike_pushups', 'jump_squats', 'plank_walkouts'
    ]
    else array[
      'pushups', 'squats', 'jumping_jacks',
      'high_knees', 'lunges', 'mountain_climbers'
    ]
  end;
$$;

-- -----------------------------------------------------------------------------
-- 3. RETIRAR LA FIRMA ANTERIOR
-- -----------------------------------------------------------------------------
-- Igual que en 00004: cambiar la lista de argumentos crea una sobrecarga, no
-- reemplaza. Dejar viva la firma de dos argumentos permitiría emparejar sin
-- nivel y saltarse el drafting.

drop function if exists public.join_queue_or_match(text, text);

-- -----------------------------------------------------------------------------
-- 4. join_queue_or_match CON NIVEL Y MISTERIO
-- -----------------------------------------------------------------------------
-- Se reproduce íntegro el cuerpo de 00004: cierre de duelos abandonados,
-- reconexión, barrido de colas fantasma y FOR UPDATE SKIP LOCKED.

create or replace function public.join_queue_or_match(
  p_country          text,
  p_game_mode        text,
  p_performance_tier text default null,
  p_is_mystery       boolean default false
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
  v_mystery     boolean := coalesce(p_is_mystery, false);
  v_options     text[];
begin
  if v_user_id is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;

  if p_country is null or char_length(trim(p_country)) = 0 then
    raise exception 'Debes seleccionar un país' using errcode = '22023';
  end if;

  if p_game_mode is null or p_game_mode not in ('aesthetics', 'performance') then
    raise exception 'Modo de juego inválido: %', p_game_mode using errcode = '22023';
  end if;

  -- Nivel y disciplina tienen que ser coherentes entre sí.
  if p_game_mode = 'performance' then
    if p_performance_tier is null or p_performance_tier not in ('normal', 'hard') then
      raise exception 'Rendimiento exige un nivel válido: %', p_performance_tier
        using errcode = '22023';
    end if;
  elsif p_performance_tier is not null then
    raise exception 'Estética no lleva nivel' using errcode = '22023';
  end if;

  -- (00003) Cerrar duelos colgados antes de mirar si hay uno activo.
  perform public.close_abandoned_matches(v_user_id);

  -- Reconexión: si sigue en un duelo activo, se vuelve a ESE duelo.
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

  -- (00002) Barrido de colas fantasma.
  delete from public.queue
   where joined_at < now() - interval '30 seconds';

  -- Coincidencia EXACTA en país, disciplina, nivel y misterio.
  -- `is not distinct from` porque en estética el nivel es NULL, y NULL = NULL
  -- sería siempre falso.
  select q.profile_id
    into v_opponent_id
    from public.queue q
   where q.country = p_country
     and q.game_mode = p_game_mode
     and q.performance_tier is not distinct from p_performance_tier
     and q.is_mystery = v_mystery
     and q.profile_id <> v_user_id
   order by q.joined_at
   limit 1
     for update skip locked;

  if v_opponent_id is not null then
    delete from public.queue where profile_id = v_opponent_id;

    -- Reparto de cartas: tres ejercicios del nivel, sorteados aquí para que
    -- los dos jugadores vean la misma mano.
    if p_game_mode = 'performance' then
      select array(
        select unnest(public.exercise_catalog(p_performance_tier))
         order by random()
         limit 3
      ) into v_options;
    else
      v_options := null;
    end if;

    insert into public.matches (
      player1_id, player2_id, status, game_mode,
      performance_tier, is_mystery, draft_options
    )
    values (
      v_opponent_id, v_user_id, 'active', p_game_mode,
      p_performance_tier, v_mystery, v_options
    )
    returning id into v_match_id;

    return v_match_id;
  end if;

  insert into public.queue (profile_id, country, game_mode, performance_tier, is_mystery)
  values (v_user_id, p_country, p_game_mode, p_performance_tier, v_mystery)
  on conflict (profile_id)
    do update set country          = excluded.country,
                  game_mode        = excluded.game_mode,
                  performance_tier = excluded.performance_tier,
                  is_mystery       = excluded.is_mystery,
                  joined_at        = now();

  return null;
end;
$$;

revoke all on function public.join_queue_or_match(text, text, text, boolean)
  from public, anon;
grant execute on function public.join_queue_or_match(text, text, text, boolean)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 5. VOTACIÓN DE LA CARTA
-- -----------------------------------------------------------------------------
-- Registra el voto y, en cuanto están los dos, resuelve:
--   · votos iguales    → ese ejercicio,
--   · votos distintos  → uno de los dos al azar, sorteado EN EL SERVIDOR.
--
-- El FOR UPDATE es imprescindible: los dos jugadores pueden pulsar su carta en
-- el mismo instante. Sin el bloqueo, ambos leerían "el rival aún no ha votado"
-- y el duelo se quedaría sin ejercicio para siempre.

create or replace function public.cast_vote(p_match_id uuid, p_exercise text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id  uuid := auth.uid();
  v_match    public.matches%rowtype;
  v_selected text;
begin
  if v_user_id is null then
    raise exception 'No autenticado' using errcode = '28000';
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

  if v_match.game_mode <> 'performance' then
    raise exception 'Este duelo no tiene fase de selección' using errcode = '22023';
  end if;

  -- Ya resuelto (o el duelo terminó): devolvemos lo que hay.
  if v_match.selected_exercise is not null or v_match.status <> 'active' then
    return v_match.selected_exercise;
  end if;

  -- Solo se puede votar una de las tres cartas repartidas. Sin esto, un cliente
  -- manipulado elegiría el ejercicio que más le convenga.
  if p_exercise is null
     or v_match.draft_options is null
     or not (p_exercise = any (v_match.draft_options)) then
    raise exception 'Ese ejercicio no está entre las cartas repartidas'
      using errcode = '22023';
  end if;

  -- El primer voto de cada jugador es el que vale.
  if v_user_id = v_match.player1_id then
    if v_match.p1_vote is null then
      update public.matches set p1_vote = p_exercise where id = p_match_id;
      v_match.p1_vote := p_exercise;
    end if;
  else
    if v_match.p2_vote is null then
      update public.matches set p2_vote = p_exercise where id = p_match_id;
      v_match.p2_vote := p_exercise;
    end if;
  end if;

  if v_match.p1_vote is not null and v_match.p2_vote is not null then
    if v_match.p1_vote = v_match.p2_vote then
      v_selected := v_match.p1_vote;
    else
      v_selected := case
        when random() < 0.5 then v_match.p1_vote
        else v_match.p2_vote
      end;
    end if;

    update public.matches
       set selected_exercise = v_selected
     where id = p_match_id;

    return v_selected;
  end if;

  -- Falta el rival.
  return null;
end;
$$;

revoke all on function public.cast_vote(uuid, text) from public, anon;
grant execute on function public.cast_vote(uuid, text) to authenticated;
