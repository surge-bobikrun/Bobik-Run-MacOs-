create or replace function public.start_bobik_run(p_mode integer,p_difficulty integer)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare v_uid uuid:=auth.uid();v_id uuid;
begin
 if v_uid is null then raise exception 'AUTH_REQUIRED';end if;
 if p_mode not between 0 and 3 or p_difficulty not between 0 and 2 then raise exception 'INVALID_CATEGORY';end if;
 update public.bobik_run_sessions set status='rejected',finished_at=now() where user_id=v_uid and status='started' and started_at<=now()-interval '30 minutes';
 if exists(select 1 from public.bobik_run_sessions where user_id=v_uid and status='started' and started_at>now()-interval '30 minutes') then raise exception 'RUN_ALREADY_ACTIVE';end if;
 insert into public.bobik_run_sessions(user_id,mode,difficulty) values(v_uid,p_mode,p_difficulty) returning id into v_id;return v_id;
end;$function$;
revoke all on function public.start_bobik_run(integer,integer) from public,anon,authenticated;grant execute on function public.start_bobik_run(integer,integer) to service_role;
