-- Bobik Run 1.9.2: balanced quests, fairer global rewards and completion feed.
-- Account balances, XP, achievements and run records are preserved.

alter table public.bobik_global_hunt_state add column if not exists mode smallint not null default -1;
alter table public.bobik_global_hunt_state add column if not exists difficulty_stars integer not null default 5;
insert into public.bobik_global_hunt_state(id,hunt_id,title,target_distance,difficulty,difficulty_stars,mode)
values(2,gen_random_uuid(),'Обычная дистанция',1200,1,6,0)
on conflict(id) do nothing;

create or replace function public.bobik_default_quest_data(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_s public.bobik_player_stats%rowtype;
  v_day text;
  v_week text;
begin
  if coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role') is distinct from 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
  select * into v_s from public.bobik_player_stats where user_id = p_user_id;
  if not found then raise exception 'STATS_NOT_FOUND'; end if;
  v_day := to_char(timezone('Asia/Almaty', now())::date, 'YYYY-MM-DD');
  v_week := to_char(timezone('Asia/Almaty', now())::date, 'IYYY-IW');
  return jsonb_build_object(
    'dailyDate',v_day,'weeklyKey',v_week,'serial',0,
    'daily',jsonb_build_array(
      jsonb_build_object('id','daily_dist_'||v_day,'title','Набрать дистанцию','desc','Проедь суммарно 1 000 м','metric','totalDistance','target',1000,'rewardType','xp','reward',60,'difficulty',2,'stars',2,'mode',-1,'startValue',v_s.total_distance,'progress',0,'done',false),
      jsonb_build_object('id','daily_runs_'||v_day,'title','Не сбавляй темп','desc','Заверши 2 забега','metric','runs','target',2,'rewardType','coins','reward',50,'difficulty',2,'stars',2,'mode',-1,'startValue',v_s.runs,'progress',0,'done',false),
      jsonb_build_object('id','daily_best_'||v_day,'title','Дальний заезд','desc','Проедь 500 м за один забег','metric','lastRun','target',500,'rewardType','xp','reward',80,'difficulty',3,'stars',3,'mode',-1,'startValue',0,'progress',0,'done',false)
    ),
    'regular',jsonb_build_array(
      jsonb_build_object('id','server_reg_'||v_week||'_0','title','Большой пробег','desc','Набери 4 000 м суммарно','metric','totalDistance','target',4000,'rewardType','xp','reward',100,'difficulty',4,'stars',4,'mode',-1,'startValue',v_s.total_distance,'progress',0,'done',false),
      jsonb_build_object('id','server_reg_'||v_week||'_1','title','Опытный водитель','desc','Заверши 5 забегов','metric','runs','target',5,'rewardType','coins','reward',80,'difficulty',4,'stars',4,'mode',-1,'startValue',v_s.runs,'progress',0,'done',false),
      jsonb_build_object('id','server_reg_'||v_week||'_2','title','Планка дальности','desc','Проедь 1 200 м за один забег','metric','lastRun','target',1200,'rewardType','xp','reward',180,'difficulty',7,'stars',7,'mode',-1,'startValue',0,'progress',0,'done',false),
      jsonb_build_object('id','server_reg_'||v_week||'_3','title','Обычный водитель','desc','Сыграй 2 раза в режиме «Обычный»','metric','modeRuns','target',2,'rewardType','coins','reward',70,'difficulty',4,'stars',4,'mode',0,'startValue',v_s.mode_runs[1],'progress',0,'done',false),
      jsonb_build_object('id','server_reg_'||v_week||'_4','title','Три жизни','desc','Сыграй 2 раза в режиме «Три жизни»','metric','modeRuns','target',2,'rewardType','xp','reward',80,'difficulty',5,'stars',5,'mode',1,'startValue',v_s.mode_runs[2],'progress',0,'done',false),
      jsonb_build_object('id','server_reg_'||v_week||'_5','title','Хардкорная полоса','desc','Сыграй 1 раз в режиме «Хардкор»','metric','modeRuns','target',1,'rewardType','xp','reward',100,'difficulty',7,'stars',7,'mode',2,'startValue',v_s.mode_runs[3],'progress',0,'done',false),
      jsonb_build_object('id','server_reg_'||v_week||'_6','title','Ночная смена','desc','Сыграй 1 раз в режиме «Кошмар»','metric','modeRuns','target',1,'rewardType','coins','reward',100,'difficulty',8,'stars',8,'mode',3,'startValue',v_s.mode_runs[4],'progress',0,'done',false),
      jsonb_build_object('id','server_reg_'||v_week||'_7','title','Сложная дорога','desc','Заверши 2 забега на сложности «Сложно»','metric','diffRuns','target',2,'rewardType','xp','reward',100,'difficulty',6,'stars',6,'mode',2,'startValue',v_s.difficulty_runs[3],'progress',0,'done',false),
      jsonb_build_object('id','server_reg_'||v_week||'_8','title','Исследователь','desc','Набери 6 000 м суммарно','metric','totalDistance','target',6000,'rewardType','coins','reward',150,'difficulty',6,'stars',6,'mode',-1,'startValue',v_s.total_distance,'progress',0,'done',false),
      jsonb_build_object('id','server_reg_'||v_week||'_9','title','Рекордный заезд','desc','Проедь 1 500 м за один забег','metric','lastRun','target',1500,'rewardType','xp','reward',220,'difficulty',9,'stars',9,'mode',-1,'startValue',0,'progress',0,'done',false)
    )
  );
end;
$$;

create or replace function public.bobik_rebalance_quest_array(p_tasks jsonb,p_daily boolean)
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(
    case
      when not coalesce((t.value->>'done')::boolean,false) and t.value->>'metric'='lastRun' and coalesce((t.value->>'target')::integer,0)>case when p_daily then 800 else 1500 end
      then t.value || jsonb_build_object('target',case when p_daily then 800 else 1500 end,'desc','Проедь '||(case when p_daily then 800 else 1500 end)::text||' м за один забег','reward',least(coalesce((t.value->>'reward')::integer,220),case when p_daily then 100 else 220 end),'stars',case when p_daily then 5 else 9 end)
      when not coalesce((t.value->>'done')::boolean,false) and t.value->>'metric'='totalDistance' and coalesce((t.value->>'target')::integer,0)>6000
      then t.value || jsonb_build_object('target',6000,'desc','Набери 6 000 м суммарно','reward',least(coalesce((t.value->>'reward')::integer,150),180),'stars',7)
      when not coalesce((t.value->>'done')::boolean,false) and t.value->>'metric'='runs' and coalesce((t.value->>'target')::integer,0)>8
      then t.value || jsonb_build_object('target',8,'desc','Заверши 8 забегов','reward',least(coalesce((t.value->>'reward')::integer,150),150),'stars',6)
      when not coalesce((t.value->>'done')::boolean,false) and t.value->>'metric'='modeRuns' and coalesce((t.value->>'target')::integer,0)>4
      then t.value || jsonb_build_object('target',4,'desc','Сыграй 4 раза в выбранном режиме','reward',least(coalesce((t.value->>'reward')::integer,140),140),'stars',7)
      when not coalesce((t.value->>'done')::boolean,false) and t.value->>'metric'='diffRuns' and coalesce((t.value->>'target')::integer,0)>5
      then t.value || jsonb_build_object('target',5,'desc','Сыграй 5 раз на выбранной сложности','reward',least(coalesce((t.value->>'reward')::integer,150),150),'stars',7)
      else t.value
    end order by t.ordinality),'[]'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(p_tasks)='array' then p_tasks else '[]'::jsonb end) with ordinality as t(value,ordinality)
$$;
revoke all on function public.bobik_rebalance_quest_array(jsonb,boolean) from public,anon,authenticated;

update public.bobik_player_stats
set quest_data=jsonb_set(jsonb_set(quest_data,'{daily}',public.bobik_rebalance_quest_array(quest_data->'daily',true),true),'{regular}',public.bobik_rebalance_quest_array(quest_data->'regular',false),true),updated_at=now()
where jsonb_typeof(quest_data)='object';
drop function public.bobik_rebalance_quest_array(jsonb,boolean);

update public.bobik_global_hunt_state
set target_distance=case when id=1 then 1500 else 1200 end,difficulty=1,difficulty_stars=case when id=1 then 7 else 6 end,title=case when id=1 then 'Общая дистанция' else 'Обычная дистанция' end,mode=case when id=1 then -1 else 0 end
where id in (1,2);


create or replace function public.get_bobik_hunt_completions()
returns table(display_name text,target_distance integer,actual_distance integer,completion_percent numeric,created_at timestamptz)
language sql security definer stable set search_path = '' as $$
  select r.display_name,r.target_distance,r.actual_distance,round((r.actual_distance::numeric/greatest(r.target_distance,1)::numeric)*100,1),r.created_at
  from public.bobik_hunt_records r order by r.created_at desc limit 100
$$;
revoke all on function public.get_bobik_hunt_completions() from public,anon,authenticated;
grant execute on function public.get_bobik_hunt_completions() to anon,authenticated;

-- Keep the server-owned reward calculation aligned with the 10-star UI scale.
do $block$
declare
  v_def text;
  v_old text;
begin
  select pg_get_functiondef('public.bobik_finish_run_for_user(uuid,uuid,integer,integer)'::regprocedure) into v_def;
  v_old := v_def;
  v_def := replace(v_def,
    'v_targets integer[]:=array[900,1200,1500,1800,2000,2200,2500,2800,3000]; v_normal_targets integer[]:=array[1200,1500,1800,2000,2200,2500,2800,3000]; v_hunt_stars integer;',
    'v_targets integer[]:=array[900,1100,1300,1500,1700,1900,2100]; v_normal_targets integer[]:=array[700,900,1100,1300,1500,1700,1800]; v_hunt_stars integer;');
  v_def := replace(v_def,'v_general_reward:=100+floor(v_hunt.target_distance/25.0)::integer;','v_general_reward:=250+floor(v_hunt.target_distance/8.0)::integer;');
  v_def := replace(v_def,'v_normal_reward:=100+floor(v_normal_hunt.target_distance/25.0)::integer;','v_normal_reward:=150+floor(v_normal_hunt.target_distance/12.0)::integer;');
  v_def := replace(v_def,'round(2+v_target/400.0)::integer','round(1+v_target/250.0)::integer');
  if v_def = v_old then
    if position('array[900,1100,1300,1500,1700,1900,2100]' in v_def)=0 then
      raise exception 'Could not safely update global hunt targets';
    end if;
  elsif position('array[900,1200,1500,1800,2000,2200,2500,2800,3000]' in v_def)>0
     or position('v_general_reward:=100+floor' in v_def)>0
     or position('v_normal_reward:=100+floor' in v_def)>0 then
    raise exception 'Could not safely update global hunt rewards';
  else
    execute v_def;
  end if;
end;
$block$;
