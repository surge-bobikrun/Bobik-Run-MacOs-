-- v1.9.3: one 6,000 m normal-mode global hunt, no separate ordinary hunt.
delete from public.bobik_global_hunt_state where id=2;
update public.bobik_global_hunt_state
set title='Глобальная охота', target_distance=6000, difficulty=2,
    difficulty_stars=8, mode=0, created_at=now()
where id=1;

do $block$
declare v_def text; v_old text;
begin
  select pg_get_functiondef('public.finish_bobik_hunt(uuid,integer)'::regprocedure) into v_def;
  v_old:=v_def;
  v_def:=replace(v_def,'v_reward := 900 + floor(v_state.target_distance / 10.0)::integer;','v_reward := 10000;');
  v_def:=replace(v_def,'v_target := v_targets[1 + floor(random() * array_length(v_targets, 1))::integer];','v_target := 6000;');
  v_def:=replace(v_def,'v_difficulty := case when v_target >= 9000 then 2 when v_target >= 6000 then 1 else 0 end;','v_difficulty := 2;');
  if v_def=v_old and (position('v_reward := 10000;' in v_def)=0 or position('v_target := 6000;' in v_def)=0) then
    raise exception 'Could not safely update global hunt reward function';
  end if;
  if position('900 + floor(v_state.target_distance / 10.0)' in v_def)>0 then
    raise exception 'Global hunt reward replacement was incomplete';
  end if;
  execute v_def;
end;
$block$;

do $block$
declare v_def text;
begin
  select pg_get_functiondef('public.bobik_finish_run_for_user(uuid,uuid,integer,integer)'::regprocedure) into v_def;
  v_def:=replace(v_def,'v_general_reward:=250+floor(v_hunt.target_distance/8.0)::integer;','v_general_reward:=10000;');
  if position('v_general_reward:=10000;' in v_def)=0 then
    raise exception 'Could not safely set global hunt XP reward';
  end if;
  execute v_def;
end;
$block$;

-- Raise the targets of existing unfinished daily and regular quests.
update public.bobik_player_stats
set quest_data=jsonb_set(
  jsonb_set(
    jsonb_set(
      jsonb_set(quest_data,'{daily}',coalesce((
        select jsonb_agg(case
          when x->>'metric'='totalDistance' and coalesce((x->>'target')::int,0)<2500 then x||jsonb_build_object('target',2500,'desc','Набери 2 500 м суммарно','stars',5)
          when x->>'metric'='runs' and coalesce((x->>'target')::int,0)<5 then x||jsonb_build_object('target',5,'desc','Заверши 5 забегов','stars',5)
          when x->>'metric'='lastRun' and coalesce((x->>'target')::int,0)<1500 then x||jsonb_build_object('target',1500,'desc','Проедь 1 500 м за один забег','stars',7)
          else x end)
        from jsonb_array_elements(coalesce(quest_data->'daily','[]'::jsonb)) x
      ),'[]'::jsonb),true),
      '{regular}',coalesce((
        select jsonb_agg(case
          when x->>'metric'='totalDistance' and coalesce((x->>'target')::int,0)<6000 then x||jsonb_build_object('target',6000,'desc','Набери 6 000 м суммарно','stars',7)
          when x->>'metric'='runs' and coalesce((x->>'target')::int,0)<10 then x||jsonb_build_object('target',10,'desc','Заверши 10 забегов','stars',6)
          when x->>'metric'='lastRun' and coalesce((x->>'target')::int,0)<2500 then x||jsonb_build_object('target',2500,'desc','Проедь 2 500 м за один забег','stars',8)
          when x->>'metric'='modeRuns' and coalesce((x->>'target')::int,0)<5 then x||jsonb_build_object('target',5,'desc','Сыграй 5 раз в выбранном режиме','stars',7)
          when x->>'metric'='diffRuns' and coalesce((x->>'target')::int,0)<5 then x||jsonb_build_object('target',5,'desc','Сыграй 5 раз на выбранной сложности','stars',7)
          else x end)
        from jsonb_array_elements(coalesce(quest_data->'regular','[]'::jsonb)) x
      ),'[]'::jsonb),true),
      '{dailyDate}',to_jsonb(coalesce(quest_data->>'dailyDate','')),true
    ),
    '{weeklyKey}',to_jsonb(coalesce(quest_data->>'weeklyKey','')),true
),updated_at=now()
where jsonb_typeof(quest_data)='object';
