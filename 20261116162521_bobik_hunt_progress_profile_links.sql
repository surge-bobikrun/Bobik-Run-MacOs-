-- Return the public user ID with global-hunt progress rows so the client
-- can open a public profile when a progress row is tapped.
-- Progress is deliberately public only to authenticated users; no private
-- account fields, email addresses, credentials or wallet fields are returned.
drop function if exists public.get_bobik_global_hunt_progress(uuid);
create function public.get_bobik_global_hunt_progress(p_hunt_id uuid)
returns table(
  user_id uuid,
  display_name text,
  best_distance integer,
  progress_percent numeric,
  completed boolean,
  attempts bigint,
  mode smallint,
  hold_seconds bigint
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_hunt public.bobik_global_hunt_state%rowtype;
begin
  select * into v_hunt
  from public.bobik_global_hunt_state
  where hunt_id = p_hunt_id;
  if not found then return; end if;

  if v_hunt.sequence_index = 5 then
    return query
    select
      h.user_id,
      coalesce(p.username, 'Нет лидера')::text,
      coalesce(l.best_distance, 0)::integer,
      round(least(100::numeric,
        coalesce(extract(epoch from (now() - h.held_since)) /
          greatest(v_hunt.hold_hours, 1) / 3600 * 100, 0)), 1),
      coalesce(h.held_since <= now() - make_interval(hours => v_hunt.hold_hours), false),
      0::bigint,
      m.mode::smallint,
      coalesce(extract(epoch from (now() - h.held_since))::bigint, 0)
    from generate_series(0, 3) m(mode)
    left join public.bobik_hunt_leader_hold h on h.mode = m.mode
    left join public.profiles p on p.id = h.user_id
    left join lateral (
      select max(best_distance)::integer as best_distance
      from public.leaderboard
      where user_id = h.user_id and mode = m.mode
    ) l on true
    order by m.mode;
  else
    return query
    select
      r.user_id,
      coalesce(p.username, 'Игрок')::text,
      max(r.distance)::integer,
      round(least(100::numeric,
        max(r.distance)::numeric * 100 / greatest(1, v_hunt.target_distance)), 1),
      max(r.distance) >= v_hunt.target_distance,
      count(*)::bigint,
      v_hunt.mode,
      0::bigint
    from public.run_history r
    join public.profiles p on p.id = r.user_id
    where r.created_at >= v_hunt.created_at
      and (v_hunt.mode = -1 or r.mode = v_hunt.mode)
    group by r.user_id, p.username
    order by (max(r.distance) >= v_hunt.target_distance) desc,
      max(r.distance) desc
    limit 100;
  end if;
end;
$$;
revoke all on function public.get_bobik_global_hunt_progress(uuid) from public, anon;
grant execute on function public.get_bobik_global_hunt_progress(uuid) to authenticated;
