-- Weekly targets tuned against actual player distance/run counts.
create or replace function public.bobik_rebalance_quest_array_v2(p_tasks jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(
    case
      when not coalesce((t.value->>'done')::boolean,false) and t.value->>'metric'='totalDistance' and coalesce((t.value->>'target')::integer,0)>3500
      then t.value || jsonb_build_object('target',3500,'desc','Набери 3 500 м суммарно','reward',least(coalesce((t.value->>'reward')::integer,120),120),'stars',5)
      when not coalesce((t.value->>'done')::boolean,false) and t.value->>'metric'='runs' and coalesce((t.value->>'target')::integer,0)>5
      then t.value || jsonb_build_object('target',5,'desc','Заверши 5 забегов','reward',least(coalesce((t.value->>'reward')::integer,80),80),'stars',5)
      else t.value
    end order by t.ordinality),'[]'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(p_tasks)='array' then p_tasks else '[]'::jsonb end) with ordinality as t(value,ordinality)
$$;
revoke all on function public.bobik_rebalance_quest_array_v2(jsonb) from public,anon,authenticated;
update public.bobik_player_stats
set quest_data=jsonb_set(jsonb_set(quest_data,'{daily}',public.bobik_rebalance_quest_array_v2(quest_data->'daily'),true),'{regular}',public.bobik_rebalance_quest_array_v2(quest_data->'regular'),true),updated_at=now()
where jsonb_typeof(quest_data)='object';
drop function public.bobik_rebalance_quest_array_v2(jsonb);

do $block$
declare v_def text; v_old text;
begin
  select pg_get_functiondef('public.bobik_default_quest_data(uuid)'::regprocedure) into v_def;
  v_old := v_def;
  v_def := replace(v_def,$old$'desc','Набери 4 000 м суммарно','metric','totalDistance','target',4000,'rewardType','xp','reward',100,'difficulty',4,'stars',4$old$,$new$'desc','Набери 2 500 м суммарно','metric','totalDistance','target',2500,'rewardType','xp','reward',80,'difficulty',3,'stars',3$new$);
  v_def := replace(v_def,$old$'desc','Заверши 5 забегов','metric','runs','target',5,'rewardType','coins','reward',80,'difficulty',4,'stars',4$old$,$new$'desc','Заверши 3 забега','metric','runs','target',3,'rewardType','coins','reward',60,'difficulty',3,'stars',3$new$);
  v_def := replace(v_def,$old$'desc','Набери 6 000 м суммарно','metric','totalDistance','target',6000,'rewardType','coins','reward',150,'difficulty',6,'stars',6$old$,$new$'desc','Набери 3 500 м суммарно','metric','totalDistance','target',3500,'rewardType','coins','reward',100,'difficulty',5,'stars',5$new$);
  if v_def=v_old or position('Набери 4 000 м суммарно' in v_def)>0 or position('Заверши 5 забегов' in v_def)>0 or position('Набери 6 000 м суммарно' in v_def)>0 or position('Набери 2 500 м суммарно' in v_def)=0 or position('Заверши 3 забега' in v_def)=0 or position('Набери 3 500 м суммарно' in v_def)=0 then
    raise exception 'Could not safely tune default quest targets';
  end if;
  execute v_def;
end;
$block$;
