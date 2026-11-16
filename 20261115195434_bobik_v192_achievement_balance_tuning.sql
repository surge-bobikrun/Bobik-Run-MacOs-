-- Make the hard/nightmare milestones attainable and improve the XP for the 2.5k milestone.
create or replace function public.bobik_tune_achievement_rewards()
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_def text; v_old text;
begin
  select pg_get_functiondef('public.bobik_finish_run_for_user(uuid,uuid,integer,integer)'::regprocedure) into v_def;
  v_old := v_def;
  v_def := replace(v_def,$old$'dist_2500',125$old$,$new$'dist_2500',200$new$);
  v_def := replace(v_def,$old$'hard_3k',450$old$,$new$'hard_3k',300$new$);
  v_def := replace(v_def,$old$'night_3k',600$old$,$new$'night_3k',400$new$);
  v_def := replace(v_def,$old$when 'hard_3k' then v_s.mode_best[3]>=3000$old$,$new$when 'hard_3k' then v_s.mode_best[3]>=2000$new$);
  v_def := replace(v_def,$old$when 'night_3k' then v_s.mode_best[4]>=3000$old$,$new$when 'night_3k' then v_s.mode_best[4]>=2000$new$);
  if v_def = v_old then
    if position($old$'dist_2500',200$old$ in v_def)=0
       or position($old$'hard_3k',300$old$ in v_def)=0
       or position($old$'night_3k',400$old$ in v_def)=0
       or position($old$v_s.mode_best[3]>=2000$old$ in v_def)=0
       or position($old$v_s.mode_best[4]>=2000$old$ in v_def)=0 then
      raise exception 'Achievement reward tuning was not applied';
    end if;
    return true;
  end if;
  if position($old$'dist_2500',125$old$ in v_def)>0
     or position($old$'hard_3k',450$old$ in v_def)>0
     or position($old$'night_3k',600$old$ in v_def)>0
     or position($old$v_s.mode_best[3]>=3000$old$ in v_def)>0
     or position($old$v_s.mode_best[4]>=3000$old$ in v_def)>0 then
    raise exception 'Could not safely tune achievement rules';
  end if;
  execute v_def;
  return true;
end;
$$;
revoke all on function public.bobik_tune_achievement_rewards() from public,anon,authenticated;
select public.bobik_tune_achievement_rewards();
drop function public.bobik_tune_achievement_rewards();
