-- Server-only data source for the owner-checked admin-panel dashboard.
create or replace function public.bobik_admin_dashboard_stats()
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'total_players',(select count(*) from public.profiles),
    'online_count',(select count(distinct user_id) from public.online_presence where last_seen >= now()-interval '90 seconds'),
    'total_runs',coalesce((select sum(runs)::bigint from public.bobik_player_stats),0),
    'total_distance',coalesce((select sum(total_distance)::bigint from public.bobik_player_stats),0),
    'best_run',coalesce((select max(best_run)::integer from public.bobik_player_stats),0),
    'top_players',coalesce((select jsonb_agg(to_jsonb(t)) from (
      select s.user_id,coalesce(p.username,'Игрок') as username,s.runs,s.total_distance,s.best_run
      from public.bobik_player_stats s left join public.profiles p on p.id=s.user_id
      order by s.total_distance desc,s.best_run desc,s.runs desc limit 5
    ) t),'[]'::jsonb),
    'hunts',coalesce((select jsonb_agg(to_jsonb(h) order by h.id) from (
      select id,mode,title,target_distance,difficulty_stars from public.bobik_global_hunt_state order by id
    ) h),'[]'::jsonb)
  )
$$;
revoke all on function public.bobik_admin_dashboard_stats() from public,anon,authenticated;
grant execute on function public.bobik_admin_dashboard_stats() to service_role;
