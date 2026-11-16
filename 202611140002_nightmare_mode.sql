-- Bobik Run v1.8.0: add the fourth leaderboard mode (Nightmare).
-- Run once in Supabase Dashboard -> SQL Editor.

alter table public.leaderboard
  drop constraint if exists leaderboard_mode_check;

alter table public.leaderboard
  add constraint leaderboard_mode_check check (mode between 0 and 3);

create or replace function public.submit_leaderboard_entry(
  p_mode integer,
  p_difficulty integer,
  p_best_distance integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_mode not between 0 and 3 or p_difficulty not between 0 and 2 then
    raise exception 'INVALID_CATEGORY';
  end if;
  if p_best_distance is null or p_best_distance < 0 or p_best_distance > 100000000 then
    raise exception 'INVALID_SCORE';
  end if;

  select username into v_name from public.profiles where id = v_uid;
  insert into public.leaderboard(user_id, mode, difficulty, display_name, best_distance, updated_at)
  values (v_uid, p_mode, p_difficulty, coalesce(v_name, 'Игрок'), p_best_distance, now())
  on conflict (user_id, mode, difficulty) do update
    set display_name = excluded.display_name,
        best_distance = greatest(public.leaderboard.best_distance, excluded.best_distance),
        updated_at = now();
end;
$$;

revoke all on function public.submit_leaderboard_entry(integer, integer, integer) from public, anon;
grant execute on function public.submit_leaderboard_entry(integer, integer, integer) to authenticated;
