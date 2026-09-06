-- =============================================================================
-- Larpfit — 00007_leaderboard.sql
-- Clasificación global para la portada.
--
-- Ejecutar en el SQL Editor del dashboard, después de 00006. Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. ÍNDICE
-- -----------------------------------------------------------------------------
-- La clasificación recorre todos los duelos terminados. Índice parcial: los
-- duelos activos no pintan nada aquí y son los menos.

create index if not exists matches_leaderboard_idx
  on public.matches (game_mode, status)
  where status = 'completed';

-- -----------------------------------------------------------------------------
-- 2. CLASIFICACIÓN GLOBAL
-- -----------------------------------------------------------------------------
-- Se elige una RPC SECURITY DEFINER en lugar de una vista materializada:
--   · `matches` tiene RLS que solo deja ver los duelos propios, así que una
--     vista normal devolvería la clasificación "personal" de cada uno,
--   · una vista materializada exigiría programar un REFRESH, y no tenemos
--     cron montado; la RPC siempre está al día.
--
-- Devuelve ÚNICAMENTE username y puntuación. Ni UUIDs, ni correos, ni el
-- desglose de duelos: lo mínimo para pintar una tabla.
--
-- Ejecutable por anónimos a propósito: la portada la ve gente sin cuenta, y
-- ese es justo el público al que la clasificación tiene que enganchar.

create or replace function public.get_global_leaderboard(
  p_game_mode text,
  p_limit     int default 10
)
returns table (
  rank     int,
  username text,
  score    numeric
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  -- Tope duro: que nadie pueda pedir la tabla entera con ?p_limit=1000000.
  v_limit int := greatest(1, least(coalesce(p_limit, 10), 100));
begin
  if p_game_mode is null or p_game_mode not in ('aesthetics', 'performance') then
    raise exception 'Modo de juego inválido: %', p_game_mode using errcode = '22023';
  end if;

  return query
  with player_scores as (
    -- Cada duelo aporta dos filas: una por jugador.
    select m.player1_id as profile_id, m.player1_score as score
      from public.matches m
     where m.status = 'completed'
       and m.game_mode = p_game_mode
       and m.player1_score is not null

    union all

    select m.player2_id, m.player2_score
      from public.matches m
     where m.status = 'completed'
       and m.game_mode = p_game_mode
       and m.player2_score is not null
  ),
  aggregated as (
    select
      ps.profile_id,
      case
        -- Rendimiento: suma histórica de repeticiones, da igual el ejercicio.
        when p_game_mode = 'performance' then sum(ps.score)
        -- Estética: el mejor V-taper conseguido, no la suma.
        else max(ps.score)
      end as total
    from player_scores ps
    group by ps.profile_id
  )
  select
    (row_number() over (order by a.total desc, p.username asc))::int,
    p.username,
    a.total
  from aggregated a
  join public.profiles p on p.id = a.profile_id
  order by a.total desc, p.username asc
  limit v_limit;
end;
$$;

revoke all on function public.get_global_leaderboard(text, int) from public;
grant execute on function public.get_global_leaderboard(text, int)
  to anon, authenticated;
