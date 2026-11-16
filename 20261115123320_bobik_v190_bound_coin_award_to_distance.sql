-- Server-side anti-idle coin clamp. The original finish function remains unchanged.
create or replace function public.bobik_finish_run_for_user_v2(p_user_id uuid,p_run_id uuid,p_distance integer,p_elapsed_seconds integer)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_run public.bobik_run_sessions%rowtype; v_result jsonb; v_base numeric(18,4); v_allowed numeric(18,4); v_adjust numeric(18,4); v_state jsonb;
begin
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
 if p_user_id is null or p_run_id is null then raise exception 'RUN_REQUIRED'; end if;
 select * into v_run from public.bobik_run_sessions where id=p_run_id and user_id=p_user_id and status='started' for update;
 if not found then raise exception 'RUN_NOT_FOUND'; end if;
 if p_distance is null or p_distance<0 or p_distance>100000 then raise exception 'INVALID_SCORE'; end if;
 if p_elapsed_seconds is null or p_elapsed_seconds<1 or p_elapsed_seconds>10800 then raise exception 'INVALID_DURATION'; end if;
 v_base:=p_elapsed_seconds*(array[1.0,1.25,1.5,2.0])[v_run.mode+1];
 v_allowed:=least(p_elapsed_seconds,ceil(p_distance/20.0))*(array[1.0,1.25,1.5,2.0])[v_run.mode+1];v_adjust:=greatest(0,v_base-v_allowed);
 v_result:=public.bobik_finish_run_for_user(p_user_id,p_run_id,p_distance,p_elapsed_seconds);
 if v_adjust>0 then update public.bobik_player_economy set coins=greatest(0,coins-v_adjust),updated_at=now() where user_id=p_user_id;v_result:=jsonb_set(v_result,'{coins_awarded}',to_jsonb(greatest(0,coalesce((v_result->>'coins_awarded')::numeric,0)-v_adjust)),true);v_state:=public.bobik_get_state_for_user(p_user_id);v_result:=jsonb_set(v_result,'{state}',v_state,true);end if;return v_result;
end;$function$;
revoke all on function public.bobik_finish_run_for_user_v2(uuid,uuid,integer,integer) from public,anon,authenticated;grant execute on function public.bobik_finish_run_for_user_v2(uuid,uuid,integer,integer) to service_role;
