-- Every completed stage of the global hunt pays exactly 5,000 XP and 2,000 coins.
do $migration$
declare v_def text;
begin
 v_def:=pg_get_functiondef('public.bobik_process_global_hunt_run(uuid,smallint,integer)'::regprocedure);
 if position('v_reward_xp:=case v_state.sequence_index when 1 then 250 when 2 then 350 when 3 then 500 else 400 end;' in v_def)=0 then raise exception 'Expected global hunt stage reward expression was not found'; end if;
 v_def:=replace(v_def,'v_reward_xp:=case v_state.sequence_index when 1 then 250 when 2 then 350 when 3 then 500 else 400 end;','v_reward_xp:=5000;');
 v_def:=replace(v_def,'v_reward_coins:=v_reward_xp;','v_reward_coins:=2000;');
 v_def:=replace(v_def,'v_reward_xp:=2000;v_reward_coins:=2000;','v_reward_xp:=5000;v_reward_coins:=2000;');
 execute v_def;
 v_def:=pg_get_functiondef('public.get_bobik_global_hunt_progress(uuid)'::regprocedure);
 if position('public.bobik_award_global_hunt_reward(v_hold.user_id,2000,2000)' in v_def)=0 then raise exception 'Expected final global hunt award expression was not found'; end if;
 v_def:=replace(v_def,'public.bobik_award_global_hunt_reward(v_hold.user_id,2000,2000)','public.bobik_award_global_hunt_reward(v_hold.user_id,5000,2000)');
 v_def:=replace(v_def,'),2000::integer,2000::integer;', '),5000::integer,2000::integer;');
 execute v_def;
end;
$migration$;
