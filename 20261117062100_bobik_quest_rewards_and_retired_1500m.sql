-- Bobik Run v1.9.4: tune quest payouts against achievements and retire legacy 1500m tasks.
-- Existing completed tasks and all account balances/progress are preserved.

create or replace function public.bobik_tune_quest_tasks_v3(p_tasks jsonb,p_regular boolean)
returns jsonb language sql immutable set search_path = '' as $$
 select coalesce(jsonb_agg(
  case when coalesce((t.value->>'done')::boolean,false) then t.value
  else
   (case
    when p_regular and t.value->>'metric'='totalDistance' and coalesce((t.value->>'target')::integer,0)<20000
      then t.value||jsonb_build_object('target',20000,'desc','Набери 20 000 м суммарно','stars',7)
    when p_regular and t.value->>'metric'='lastRun' and coalesce((t.value->>'target')::integer,0)<3500
      then t.value||jsonb_build_object('target',3500,'desc','Проедь 3 500 м за один забег','stars',8)
    when p_regular and t.value->>'metric'='runs' and coalesce((t.value->>'target')::integer,0)<12
      then t.value||jsonb_build_object('target',12,'desc','Заверши 12 забегов','stars',6)
    when p_regular and t.value->>'metric' in ('modeRuns','diffRuns') and coalesce((t.value->>'target')::integer,0)<8
      then t.value||jsonb_build_object('target',8,'stars',7)
    when not p_regular and t.value->>'metric'='totalDistance' and coalesce((t.value->>'target')::integer,0)<5000
      then t.value||jsonb_build_object('target',5000,'desc','Набери 5 000 м суммарно','stars',5)
    when not p_regular and t.value->>'metric'='runs' and coalesce((t.value->>'target')::integer,0)<8
      then t.value||jsonb_build_object('target',8,'desc','Заверши 8 забегов','stars',5)
    when not p_regular and t.value->>'metric'='lastRun' and coalesce((t.value->>'target')::integer,0)<2000
      then t.value||jsonb_build_object('target',2000,'desc','Проедь 2 000 м за один забег','stars',6)
    else t.value end)
   || jsonb_build_object('reward',case
     when not p_regular and t.value->>'metric'='totalDistance' then 35
     when not p_regular and t.value->>'metric'='runs' then 30
     when not p_regular and t.value->>'metric'='lastRun' then 45
     when p_regular and t.value->>'metric'='totalDistance' and coalesce((t.value->>'target')::integer,0)>=30000 then 65
     when p_regular and t.value->>'metric'='totalDistance' then 45
     when p_regular and t.value->>'metric'='runs' then 45
     when p_regular and t.value->>'metric'='lastRun' and coalesce((t.value->>'target')::integer,0)>=4500 then 80
     when p_regular and t.value->>'metric'='lastRun' then 70
     when p_regular and t.value->>'metric'='modeRuns' then 55
     when p_regular and t.value->>'metric'='diffRuns' then 60
     else greatest(20,least(80,coalesce((t.value->>'reward')::integer,40))) end)
  end order by t.ordinality),'[]'::jsonb)
 from jsonb_array_elements(case when jsonb_typeof(p_tasks)='array' then p_tasks else '[]'::jsonb end)
 with ordinality as t(value,ordinality)
$$;
revoke all on function public.bobik_tune_quest_tasks_v3(jsonb,boolean) from public,anon,authenticated;

-- Tune future server-generated quests without changing the existing task structure.
do $block$
declare v_def text; v_old text;
begin
 select pg_get_functiondef('public.bobik_default_quest_data(uuid)'::regprocedure) into v_def;
 v_old:=v_def;
 v_def:=replace(v_def,$a$'target',5000,'rewardType','xp','reward',50$a$,$b$'target',5000,'rewardType','xp','reward',35$b$);
 v_def:=replace(v_def,$a$'target',8,'rewardType','coins','reward',45$a$,$b$'target',8,'rewardType','coins','reward',30$b$);
 v_def:=replace(v_def,$a$'target',2000,'rewardType','xp','reward',70$a$,$b$'target',2000,'rewardType','xp','reward',45$b$);
 v_def:=replace(v_def,$a$'target',20000,'rewardType','xp','reward',80$a$,$b$'target',20000,'rewardType','xp','reward',45$b$);
 v_def:=replace(v_def,$a$'target',12,'rewardType','coins','reward',65$a$,$b$'target',12,'rewardType','coins','reward',45$b$);
 v_def:=replace(v_def,$a$'target',3500,'rewardType','xp','reward',100$a$,$b$'target',3500,'rewardType','xp','reward',70$b$);
 v_def:=replace(v_def,$a$'target',8,'rewardType','coins','reward',70$a$,$b$'target',8,'rewardType','coins','reward',55$b$);
 v_def:=replace(v_def,$a$'target',8,'rewardType','xp','reward',75$a$,$b$'target',8,'rewardType','xp','reward',55$b$);
 v_def:=replace(v_def,$a$'target',8,'rewardType','xp','reward',85$a$,$b$'target',8,'rewardType','xp','reward',60$b$);
 v_def:=replace(v_def,$a$'target',30000,'rewardType','coins','reward',90$a$,$b$'target',30000,'rewardType','coins','reward',65$b$);
 v_def:=replace(v_def,$a$'target',4500,'rewardType','xp','reward',125$a$,$b$'target',4500,'rewardType','xp','reward',80$b$);
 if v_def=v_old or position($q$'reward',125$q$ in v_def)>0 or position($q$'reward',100$q$ in v_def)>0 then
  raise exception 'Could not safely tune default quest rewards';
 end if;
 execute v_def;
end;
$block$;

-- Replace unfinished legacy 1500m / low-distance tasks in existing saves and reduce payouts.
update public.bobik_player_stats
set quest_data=jsonb_set(
  jsonb_set(quest_data,'{daily}',public.bobik_tune_quest_tasks_v3(quest_data->'daily',false),true),
  '{regular}',public.bobik_tune_quest_tasks_v3(quest_data->'regular',true),true),
  updated_at=now()
where jsonb_typeof(quest_data)='object';

drop function public.bobik_tune_quest_tasks_v3(jsonb,boolean);
