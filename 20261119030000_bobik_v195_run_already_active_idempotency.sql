-- Bobik Run v1.9.5: make same-category run starts idempotent.
-- Prevents a pre-created/retried active session from blocking the player's start.
create or replace function public.bobik_start_run_for_user(
  p_user_id uuid, p_mode integer, p_difficulty integer
) returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_id uuid;
  v_active record;
  v_recent integer;
begin
  if coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  ) is distinct from 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;
  if p_user_id is null then raise exception 'USER_REQUIRED'; end if;
  if p_mode not between 0 and 3 or p_difficulty not between 0 and 2 then
    raise exception 'INVALID_CATEGORY';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 918273));

  update public.bobik_run_sessions
     set status = 'rejected', finished_at = coalesce(finished_at, now())
   where user_id = p_user_id
     and status = 'started'
     and started_at < now() - interval '30 minutes';

  select id, mode, difficulty
    into v_active
    from public.bobik_run_sessions
   where user_id = p_user_id and status = 'started'
   order by started_at desc
   limit 1;

  if found then
    if v_active.mode = p_mode and v_active.difficulty = p_difficulty then
      return v_active.id;
    end if;
    raise exception 'RUN_ALREADY_ACTIVE';
  end if;

  select count(*) into v_recent
    from public.bobik_run_sessions
   where user_id = p_user_id
     and started_at > now() - interval '1 minute';
  if v_recent >= 8 then raise exception 'RUN_START_RATE_LIMIT'; end if;

  insert into public.bobik_run_sessions(user_id, mode, difficulty)
  values (p_user_id, p_mode, p_difficulty)
  returning id into v_id;
  return v_id;
end;
$function$;
