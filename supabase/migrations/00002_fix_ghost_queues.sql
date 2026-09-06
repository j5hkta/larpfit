-- =============================================================================
-- Larpfit — 00002_fix_ghost_queues.sql
-- Colas fantasma: si un usuario cierra la pestaña mientras busca, su fila se
-- queda en `queue` y otro jugador acaba emparejado contra alguien que ya no
-- está. Antes de buscar rival barremos las entradas caducadas.
--
-- Ejecutar en el SQL Editor del dashboard de Supabase, después de 00001.
-- Idempotente: reemplaza la función completa.
-- =============================================================================

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

  -- NUEVO EN 00002 — barrido de colas fantasma.
  -- Un cliente vivo vuelve a llamar a esta función periódicamente, así que
  -- 30 segundos de antigüedad significan pestaña cerrada o conexión perdida.
  delete from public.queue
   where joined_at < now() - interval '30 seconds';

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
-- Latido de la cola
-- -----------------------------------------------------------------------------
-- El barrido de arriba solo funciona si los clientes vivos refrescan su
-- `joined_at`. Esta función es la que debe llamar el cliente cada ~10 s
-- mientras está buscando.

create or replace function public.heartbeat_queue()
returns void
language sql
security definer
set search_path = public
as $$
  update public.queue
     set joined_at = now()
   where profile_id = auth.uid();
$$;

revoke all on function public.heartbeat_queue() from public, anon;
grant execute on function public.heartbeat_queue() to authenticated;
