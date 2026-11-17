-- Bobik Run v1.9.4: make the five-step hunt the only active hunt path.
-- This also keeps the packaged migrations aligned with the live project.

create or replace function public.bobik_award_global_hunt_reward(p_user_id uuid,p_xp integer,p_coins integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 v_p public.player_progress%rowtype;v_name text;v_old_level integer;v_new_level integer:=1;
 v_threshold bigint:=0;v_need bigint;v_new_xp bigint;v_level_coins integer:=0;i integer;
begin
 select * into v_p from public.player_progress where user_id=p_user_id for update;
 if not found then
  select username into v_name from public.profiles where id=p_user_id;
  insert into public.player_progress(user_id,display_name,xp,level,achievements,updated_at)
  values(p_user_id,coalesce(v_name,'Игрок'),0,1,'{}',now()) returning * into v_p;
 end if;
 v_old_level:=greatest(1,coalesce(v_p.level,1));
 v_new_xp:=least(24366487,coalesce(v_p.xp,0)+greatest(0,p_xp));
 while v_new_level<1000 loop
  v_need:=floor(120+8*power(v_new_level::numeric,1.28))::bigint;
  exit when v_threshold+v_need>v_new_xp;
  v_threshold:=v_threshold+v_need;v_new_level:=v_new_level+1;
 end loop;
 if v_new_level>v_old_level then
  for i in (v_old_level+1)..v_new_level loop v_level_coins:=v_level_coins+12+floor(i*0.35)::integer;end loop;
 end if;
 update public.player_progress set xp=v_new_xp,level=v_new_level,updated_at=now() where user_id=p_user_id;
 insert into public.bobik_player_economy(user_id,coins,updated_at)
 values(p_user_id,greatest(0,p_coins)+v_level_coins,now())
 on conflict(user_id) do update set coins=public.bobik_player_economy.coins+excluded.coins,updated_at=now();
 return jsonb_build_object('xp',greatest(0,p_xp),'coins',greatest(0,p_coins),'level_coins',v_level_coins,'level',v_new_level,'xp_total',v_new_xp);
end;
$$;
revoke all on function public.bobik_award_global_hunt_reward(uuid,integer,integer) from public,anon,authenticated;

create or replace function public.bobik_process_global_hunt_run(p_user_id uuid,p_mode smallint,p_distance integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 v_state public.bobik_global_hunt_state%rowtype;v_hold public.bobik_hunt_all_categories_hold%rowtype;
 v_name text;v_reward_xp integer;v_reward_coins integer;v_award jsonb;v_advance jsonb;v_rows integer;
begin
 if coalesce(nullif(current_setting('request.jwt.claim.role',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role') is distinct from 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED';end if;
 select * into v_state from public.bobik_global_hunt_state where id=1 for update;
 if not found or v_state.is_completed then return jsonb_build_object('success',false,'inactive',true);end if;
 select coalesce(username,'Игрок') into v_name from public.profiles where id=p_user_id;v_name:=coalesce(v_name,'Игрок');
 if v_state.sequence_index between 1 and 4 then
  if p_mode<>v_state.mode or p_distance<v_state.target_distance then return jsonb_build_object('success',false,'not_completed',true,'sequence_index',v_state.sequence_index);end if;
  insert into public.bobik_hunt_records(hunt_id,user_id,display_name,target_distance,actual_distance)
  values(v_state.hunt_id,p_user_id,v_name,v_state.target_distance,p_distance) on conflict(hunt_id) do nothing;
  get diagnostics v_rows=row_count;
  if v_rows=0 then return jsonb_build_object('success',false,'stale',true);end if;
  v_reward_xp:=case v_state.sequence_index when 1 then 250 when 2 then 350 when 3 then 500 else 400 end;
  v_reward_coins:=v_reward_xp;
  update public.bobik_player_stats set hunts=hunts+1,updated_at=now() where user_id=p_user_id;
  v_award:=public.bobik_award_global_hunt_reward(p_user_id,v_reward_xp,v_reward_coins);
  v_advance:=public.bobik_advance_global_hunt(v_state.hunt_id);
  return coalesce(v_advance,'{}'::jsonb)||jsonb_build_object('success',true,'completed_sequence',v_state.sequence_index,
   'reward_xp',v_reward_xp,'reward_coins',v_reward_coins,'level_coins',coalesce((v_award->>'level_coins')::integer,0),'winner_user_id',p_user_id);
 end if;
 perform public.bobik_reconcile_hunt_leader_holds();
 select * into v_hold from public.bobik_hunt_all_categories_hold where user_id=p_user_id and hunt_id=v_state.hunt_id;
 if found and v_hold.held_since<=now()-make_interval(hours=>v_state.hold_hours) then
  insert into public.bobik_hunt_records(hunt_id,user_id,display_name,target_distance,actual_distance)
  values(v_state.hunt_id,p_user_id,v_name,10,10) on conflict(hunt_id) do nothing;
  get diagnostics v_rows=row_count;
  if v_rows=0 then return jsonb_build_object('success',false,'stale',true);end if;
  v_reward_xp:=2000;v_reward_coins:=2000;
  update public.bobik_player_stats set hunts=hunts+1,updated_at=now() where user_id=p_user_id;
  v_award:=public.bobik_award_global_hunt_reward(p_user_id,v_reward_xp,v_reward_coins);
  v_advance:=public.bobik_advance_global_hunt(v_state.hunt_id);
  return coalesce(v_advance,'{}'::jsonb)||jsonb_build_object('success',true,'completed_sequence',5,
   'reward_xp',v_reward_xp,'reward_coins',v_reward_coins,'level_coins',coalesce((v_award->>'level_coins')::integer,0),'winner_user_id',p_user_id);
 end if;
 return jsonb_build_object('success',false,'hold_in_progress',found,
  'hold_seconds',case when found then greatest(0,floor(extract(epoch from(now()-v_hold.held_since)))::integer) else 0 end);
end;
$$;
revoke all on function public.bobik_process_global_hunt_run(uuid,smallint,integer) from public,anon,authenticated;
grant execute on function public.bobik_process_global_hunt_run(uuid,smallint,integer) to service_role;

drop function if exists public.get_bobik_global_hunt_progress(uuid);
create function public.get_bobik_global_hunt_progress(p_hunt_id uuid)
returns table(user_id uuid,display_name text,best_distance integer,progress_percent numeric,
              completed boolean,attempts bigint,mode smallint,hold_seconds bigint,reward_xp integer,reward_coins integer)
language plpgsql security definer set search_path = '' as $$
declare v_hunt public.bobik_global_hunt_state%rowtype;v_hold public.bobik_hunt_all_categories_hold%rowtype;
 v_award jsonb;v_rows integer;v_name text;
begin
 select * into v_hunt from public.bobik_global_hunt_state where hunt_id=p_hunt_id for update;
 if not found then return;end if;
 if v_hunt.sequence_index=5 then
  perform public.bobik_reconcile_hunt_leader_holds();
  select * into v_hold from public.bobik_hunt_all_categories_hold where hunt_id=p_hunt_id
   and held_since<=now()-make_interval(hours=>v_hunt.hold_hours) order by held_since asc limit 1;
  if found then
   select coalesce(username,'Игрок') into v_name from public.profiles where id=v_hold.user_id;
   insert into public.bobik_hunt_records(hunt_id,user_id,display_name,target_distance,actual_distance)
   values(p_hunt_id,v_hold.user_id,coalesce(v_name,'Игрок'),10,10) on conflict(hunt_id) do nothing;
   get diagnostics v_rows=row_count;
   if v_rows=1 then
    update public.bobik_player_stats set hunts=hunts+1,updated_at=now() where user_id=v_hold.user_id;
    v_award:=public.bobik_award_global_hunt_reward(v_hold.user_id,2000,2000);
    perform public.bobik_advance_global_hunt(p_hunt_id);
    return query select v_hold.user_id,coalesce(v_name,'Игрок')::text,10::integer,100::numeric,true,0::bigint,(-1)::smallint,
     greatest(0,extract(epoch from(now()-v_hold.held_since))::bigint),2000::integer,2000::integer;
    return;
   end if;
  end if;
  return query select h.user_id,coalesce(p.username,'Игрок')::text,10::integer,
   round(least(100::numeric,extract(epoch from(now()-h.held_since))/greatest(v_hunt.hold_hours,1)/3600*100),1),
   false,0::bigint,(-1)::smallint,greatest(0,extract(epoch from(now()-h.held_since))::bigint),0::integer,0::integer
   from public.bobik_hunt_all_categories_hold h join public.profiles p on p.id=h.user_id
   where h.hunt_id=p_hunt_id order by h.held_since asc;
 else
  return query select r.user_id,coalesce(p.username,'Игрок')::text,max(r.distance)::integer,
   round(least(100::numeric,max(r.distance)::numeric*100/greatest(1,v_hunt.target_distance)),1),
   max(r.distance)>=v_hunt.target_distance,count(*)::bigint,v_hunt.mode,0::bigint,0::integer,0::integer
   from public.run_history r join public.profiles p on p.id=r.user_id
   where r.created_at>=v_hunt.created_at and r.mode=v_hunt.mode
   group by r.user_id,p.username order by (max(r.distance)>=v_hunt.target_distance) desc,max(r.distance) desc limit 100;
 end if;
end;
$$;
revoke all on function public.get_bobik_global_hunt_progress(uuid) from public,anon;
grant execute on function public.get_bobik_global_hunt_progress(uuid) to authenticated;

-- Disable the retired random hunt implementation inside the base run finisher.
-- The v2 wrapper calls bobik_process_global_hunt_run, which is now the only authority.
do $block$
declare v_def text;v_old text;
begin
 select pg_get_functiondef('public.bobik_finish_run_for_user(uuid,uuid,integer,integer)'::regprocedure) into v_def;
 v_old:=v_def;
 v_def:=replace(v_def,'v_hunt_eligible:=(v_hold_count=4);','v_hunt_eligible:=false;');
 v_def:=replace(v_def,'v_hunt_eligible:=(p_distance>=v_hunt.target_distance and (v_hunt.mode=-1 or v_run.mode=v_hunt.mode));','v_hunt_eligible:=false;');
 if v_def=v_old or position('v_hunt_eligible:=(v_hold_count=4);' in v_def)>0
   or position('v_hunt_eligible:=(p_distance>=v_hunt.target_distance' in v_def)>0 then
  raise exception 'Could not safely disable retired global hunt path';
 end if;
 execute v_def;
end;
$block$;

-- The Nightmare weekly task should pay the same as other mode-specific tasks.
do $block$
declare v_def text;v_old text;
begin
 select pg_get_functiondef('public.bobik_default_quest_data(uuid)'::regprocedure) into v_def;
 v_old:=v_def;
 v_def:=replace(v_def,$a$'target',8,'rewardType','coins','reward',80$a$,$b$'target',8,'rewardType','coins','reward',55$b$);
 if v_def=v_old then raise exception 'Could not safely tune Nightmare task reward';end if;
 execute v_def;
end;
$block$;

update public.bobik_player_stats s
set quest_data=jsonb_set(s.quest_data,'{regular}',coalesce((
 select jsonb_agg(case when not coalesce((t.value->>'done')::boolean,false)
   and t.value->>'metric'='modeRuns' and coalesce((t.value->>'mode')::integer,-1)=3
   then t.value||jsonb_build_object('reward',55) else t.value end order by t.ordinality)
 from jsonb_array_elements(coalesce(s.quest_data->'regular','[]'::jsonb)) with ordinality t(value,ordinality)
),'[]'::jsonb),true),updated_at=now()
where jsonb_typeof(s.quest_data)='object';
