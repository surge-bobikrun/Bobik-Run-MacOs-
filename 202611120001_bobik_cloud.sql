-- Bobik Run: cloud accounts, per-account saves, global leaderboard and promo codes.
-- Run this whole file in Supabase Dashboard -> SQL Editor.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null default 'Игрок' check (char_length(username) between 1 and 24),
  created_at timestamptz not null default now()
);

create table if not exists public.game_saves (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.leaderboard (
  user_id uuid not null references auth.users(id) on delete cascade,
  mode smallint not null check (mode between 0 and 2),
  difficulty smallint not null check (difficulty between 0 and 2),
  display_name text not null default 'Игрок',
  best_distance integer not null default 0 check (best_distance >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, mode, difficulty)
);
create index if not exists leaderboard_rank_idx
  on public.leaderboard(mode, difficulty, best_distance desc, updated_at asc);

create table if not exists public.promo_redemptions (
  user_id uuid not null references auth.users(id) on delete cascade,
  code text not null,
  redeemed_at timestamptz not null default now(),
  primary key (user_id, code)
);

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role = 'admin'),
  created_at timestamptz not null default now()
);

-- New Auth users get a public display-name row. The client cannot set roles.
create or replace function public.handle_bobik_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  v_name := left(coalesce(nullif(new.raw_user_meta_data ->> 'username', ''), nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'Игрок'), 24);
  insert into public.profiles(id, username) values (new.id, v_name)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_bobik_auth_user_created on auth.users;
create trigger on_bobik_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_bobik_new_user();

-- Backfill profiles for Auth users that existed before this migration.
insert into public.profiles(id, username)
select u.id, left(coalesce(nullif(u.raw_user_meta_data ->> 'username', ''), nullif(split_part(coalesce(u.email, ''), '@', 1), ''), 'Игрок'), 24)
from auth.users u
on conflict (id) do nothing;

-- Enable RLS for every exposed table.
alter table public.profiles enable row level security;
alter table public.game_saves enable row level security;
alter table public.leaderboard enable row level security;
alter table public.promo_redemptions enable row level security;
alter table public.user_roles enable row level security;

-- Start with no table grants, then grant only the operations used by the game.
revoke all on public.profiles, public.game_saves, public.leaderboard,
  public.promo_redemptions, public.user_roles from anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update on public.game_saves to authenticated;
grant select on public.leaderboard to anon, authenticated;
grant insert, update on public.leaderboard to authenticated;
-- promo_redemptions and user_roles intentionally have no client grants.

drop policy if exists "profile_select_own" on public.profiles;
create policy "profile_select_own" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
drop policy if exists "profile_update_own" on public.profiles;
create policy "profile_update_own" on public.profiles
  for update to authenticated using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "save_select_own" on public.game_saves;
create policy "save_select_own" on public.game_saves
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "save_insert_own" on public.game_saves;
create policy "save_insert_own" on public.game_saves
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "save_update_own" on public.game_saves;
create policy "save_update_own" on public.game_saves
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "leaderboard_public_read" on public.leaderboard;
create policy "leaderboard_public_read" on public.leaderboard
  for select to anon, authenticated using (true);
drop policy if exists "leaderboard_insert_own" on public.leaderboard;
create policy "leaderboard_insert_own" on public.leaderboard
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "leaderboard_update_own" on public.leaderboard;
create policy "leaderboard_update_own" on public.leaderboard
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- A player may submit only their own record. The stored score never decreases.
create or replace function public.submit_leaderboard_entry(
  p_mode integer,
  p_difficulty integer,
  p_best_distance integer
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_mode not between 0 and 2 or p_difficulty not between 0 and 2 then
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

-- Promo redemption is atomic and one-time per account. Client code never sees reward values
-- as an authority: the database changes the saved JSON itself.
create or replace function public.redeem_game_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_code text := lower(trim(coalesce(p_code, '')));
  v_save jsonb;
  v_coins numeric;
  v_owned jsonb;
  v_redeemed jsonb;
  v_message text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_code not in ('bobiksecret', 'freeartemus', 'bananus') then
    raise exception 'INVALID_CODE';
  end if;

  insert into public.promo_redemptions(user_id, code)
  values (v_uid, v_code)
  on conflict (user_id, code) do nothing;
  if not found then raise exception 'CODE_ALREADY_USED'; end if;

  select data into v_save from public.game_saves where user_id = v_uid for update;
  if v_save is null then
    v_save := jsonb_build_object('c', 60, 'ov', jsonb_build_array(0), 'vh', 0, 'redeemed', '[]'::jsonb);
  end if;
  v_redeemed := coalesce(v_save -> 'redeemed', '[]'::jsonb);
  if jsonb_typeof(v_redeemed) <> 'array' then v_redeemed := '[]'::jsonb; end if;
  v_redeemed := v_redeemed || jsonb_build_array(v_code);
  v_save := jsonb_set(v_save, '{redeemed}', v_redeemed, true);

  if v_code = 'bobiksecret' then
    v_coins := greatest(0::numeric, coalesce((v_save ->> 'c')::numeric, 60)) + 100;
    v_save := jsonb_set(v_save, '{c}', to_jsonb(v_coins), true);
    v_message := 'Начислено 100 монет!';
  elsif v_code = 'freeartemus' then
    v_coins := greatest(0::numeric, coalesce((v_save ->> 'c')::numeric, 60)) + 300;
    v_save := jsonb_set(v_save, '{c}', to_jsonb(v_coins), true);
    v_message := 'Начислено 300 монет!';
  else
    v_owned := coalesce(v_save -> 'ov', '[0]'::jsonb);
    if jsonb_typeof(v_owned) <> 'array' then v_owned := '[0]'::jsonb; end if;
    if not (v_owned @> '[3]'::jsonb) then v_owned := v_owned || '[3]'::jsonb; end if;
    v_save := jsonb_set(v_save, '{ov}', v_owned, true);
    v_save := jsonb_set(v_save, '{vh}', '3'::jsonb, true);
    v_message := 'Машина «Банан» открыта и выбрана!';
  end if;

  insert into public.game_saves(user_id, data, updated_at)
  values (v_uid, v_save, now())
  on conflict (user_id) do update set data = excluded.data, updated_at = now();

  return jsonb_build_object('success', true, 'message', v_message, 'save', v_save);
end;
$$;
revoke all on function public.redeem_game_code(text) from public, anon;
grant execute on function public.redeem_game_code(text) to authenticated;

-- Keep moderation roles private to the Edge Function's server-side secret key.
revoke all on public.promo_redemptions, public.user_roles from anon, authenticated;

-- No client-side policy or grant can read or write roles or promo history directly.
