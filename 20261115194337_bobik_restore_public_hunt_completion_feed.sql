-- Public feed intentionally exposes display names and run distances only, never account UUIDs.
create or replace function public.get_bobik_hunt_completions()
returns table(display_name text,target_distance integer,actual_distance integer,completion_percent numeric,created_at timestamptz)
language sql security definer stable set search_path = '' as $$
  select r.display_name,r.target_distance,r.actual_distance,
         round((r.actual_distance::numeric/greatest(r.target_distance,1)::numeric)*100,1),
         r.created_at
  from public.bobik_hunt_records r
  order by r.created_at desc
  limit 100
$$;
revoke all on function public.get_bobik_hunt_completions() from public,anon,authenticated;
grant execute on function public.get_bobik_hunt_completions() to anon,authenticated;
