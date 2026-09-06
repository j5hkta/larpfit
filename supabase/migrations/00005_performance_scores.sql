-- =============================================================================
-- Larpfit — 00005_performance_scores.sql
-- El rango de puntuación pasa a depender de la disciplina.
--
-- POR QUÉ: submit_score() (00003) valida `p_score > 0 and p_score <= 10`, un
-- rango pensado para el ratio del V-taper. Con planchas eso rompe dos veces:
--   · una serie de más de 10 repeticiones se rechaza con "fuera de rango",
--   · un 0 legítimo (nadie completó una plancha) tampoco se puede enviar,
--     y sin las dos puntuaciones el duelo nunca se resuelve.
--
-- Ejecutar en el SQL Editor del dashboard de Supabase, después de 00004.
-- Idempotente.
-- =============================================================================

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

  if p_score is null then
    raise exception 'Falta la puntuación' using errcode = '22023';
  end if;

  -- El bloqueo sigue siendo imprescindible: los dos cronómetros llegan a cero
  -- a la vez y ambos jugadores envían casi en el mismo instante. Sin él, los
  -- dos leerían "el otro aún no ha puntuado" y el duelo quedaría activo.
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

  -- El rango se valida CONTRA EL MODO DEL DUELO, que lo fijó el servidor al
  -- crear el match. El cliente no elige con qué baremo se le mide.
  if v_match.game_mode = 'performance' then
    -- Repeticiones: enteros, desde 0. El tope corta valores absurdos de un
    -- cliente manipulado sin estorbar a nadie real.
    if p_score < 0 or p_score > 500 then
      raise exception 'Repeticiones fuera de rango: %', p_score
        using errcode = '22023';
    end if;

    if p_score <> trunc(p_score) then
      raise exception 'Las repeticiones deben ser un número entero'
        using errcode = '22023';
    end if;
  else
    -- V-taper: ratio hombros/cintura, siempre positivo.
    if p_score <= 0 or p_score > 10 then
      raise exception 'Puntuación fuera de rango: %', p_score
        using errcode = '22023';
    end if;
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

  -- ¿Están las dos? Entonces hay veredicto. Gana la más alta en ambos modos:
  -- más V-taper o más repeticiones.
  if v_match.player1_score is not null and v_match.player2_score is not null then
    v_winner := case
      when v_match.player1_score > v_match.player2_score then v_match.player1_id
      when v_match.player2_score > v_match.player1_score then v_match.player2_id
      else null  -- empate exacto (dos ceros en rendimiento, por ejemplo)
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
