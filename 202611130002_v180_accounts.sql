-- Bobik Run 1.8.0: unique usernames, authoritative rename, creator badge and stricter table access.
-- Run this migration in Supabase Dashboard -> SQL Editor before publishing the 1.8.0 client.

-- Resolve any legacy duplicate nicknames before adding the unique index.
with ranked as (
  select id, username,
         row_number() over (partition by lower(btrim(username)) order by created_at asc, id asc) as rn
  from public.profiles
)
update public.profiles p
set username = left(btrim(p.username), 15) || '-' || left(p.id::text, 8)
from ranked r
where r.id = p.id and r.rn > 1;

-- A generated lookup key makes case-insensitive username matching consistent for
-- both uniqueness checks and the server-side sign-in gateway.
alter table public.profiles
  add column if not exists username_key text generated always as (lower(btrim(username))) stored;
create unique index if not exists profiles_username_key_unique
  on public.profiles(username_key);

create or replace function public.validate_bobik_username_field()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.username := btrim(coalesce(new.username, ''));
  if char_length(new.username) < 2 or char_length(new.username) > 14
     or position('<' in new.username) > 0
     or position('>' in new.username) > 0
     or new.username ~ '[[:cntrl:]]' then
    raise exception 'INVALID_USERNAME';
  end if;
  return new;
end;
$$;

drop trigger if exists bobik_validate_profile_username on public.profiles;
create trigger bobik_validate_profile_username
before insert or update of username on public.profiles
for each row execute function public.validate_bobik_username_field();

-- New signups are validated in the database too. The client-side availability
-- check is only a convenience; the unique index is the actual lock.
create or replace function public.handle_bobik_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(new.raw_user_meta_data ->> 'username', ''));
begin
  if char_length(v_name) < 2 or char_length(v_name) > 14 then
    raise exception 'INVALID_USERNAME';
  end if;
  insert into public.profiles(id, username) values (new.id, v_name)
  on conflict (id) do nothing;
  return new;
exception when unique_violation then
  raise exception using message = 'USERNAME_TAKEN', errcode = '23505';
end;
$$;

drop trigger if exists on_bobik_auth_user_created on auth.users;
create trigger on_bobik_auth_user_created
after insert on auth.users
for each row execute function public.handle_bobik_new_user();

-- Creator status is private from client writes, but readable in public profiles / leaderboard.
alter table public.public_profiles
  add column if not exists is_creator boolean not null default false;

-- The original creator account registered with the username "zoha". Its synthetic
-- Auth email is stable even if its public nickname has since become "surge".
insert into public.public_profiles(user_id, username, is_creator)
select p.id, p.username,
       lower(coalesce(u.email, '')) = 'u33156eeacb726f222578a41d8feddb558a44a66f9074837940930b225e9da80e@accounts.example.com'
from public.profiles p
join auth.users u on u.id = p.id
on conflict (user_id) do update
set username = excluded.username,
    is_creator = excluded.is_creator,
    updated_at = now();

update public.leaderboard l
set display_name = p.username
from public.profiles p
where p.id = l.user_id;

-- Public profile nicknames always mirror the authoritative unique profiles row.
create or replace function public.sync_bobik_public_profile_username()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  select p.username into v_name
  from public.profiles p
  where p.id = new.user_id;
  if v_name is null then
    raise exception 'PROFILE_NOT_FOUND';
  end if;
  new.username := v_name;
  return new;
end;
$$;

drop trigger if exists bobik_public_profile_username_sync on public.public_profiles;
create trigger bobik_public_profile_username_sync
before insert or update on public.public_profiles
for each row execute function public.sync_bobik_public_profile_username();

-- Check availability before signup. The unique index remains the final protection
-- against simultaneous registrations attempting the same nickname.
create or replace function public.bobik_username_available(p_username text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_username, ''));
begin
  if char_length(v_name) < 2 or char_length(v_name) > 14
     or position('<' in v_name) > 0
     or position('>' in v_name) > 0
     or v_name ~ '[[:cntrl:]]' then
    return false;
  end if;
  return not exists (
    select 1 from public.profiles p
    where p.username_key = lower(v_name)
  );
end;
$$;
revoke all on function public.bobik_username_available(text) from public;
grant execute on function public.bobik_username_available(text) to anon, authenticated;

-- Rename is one transaction: reserve the new nickname, release the previous one,
-- update public profile, saved nickname and every leaderboard row.
create or replace function public.rename_bobik_username(p_username text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_username, ''));
  v_old text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if char_length(v_name) < 2 or char_length(v_name) > 14
     or position('<' in v_name) > 0
     or position('>' in v_name) > 0
     or v_name ~ '[[:cntrl:]]' then
    raise exception 'INVALID_USERNAME';
  end if;

  select p.username into v_old from public.profiles p where p.id = v_uid;
  if v_old is null then raise exception 'PROFILE_NOT_FOUND'; end if;

  begin
    update public.profiles set username = v_name where id = v_uid;
  exception when unique_violation then
    raise exception using message = 'USERNAME_TAKEN', errcode = '23505';
  end;

  insert into public.public_profiles(user_id, username, avatar, photo, bio, updated_at)
  values (v_uid, v_name, 0, null, null, now())
  on conflict (user_id) do update
    set username = excluded.username, updated_at = now();

  update public.game_saves
  set data = jsonb_set(coalesce(data, '{}'::jsonb), '{pn}', to_jsonb(v_name), true),
      updated_at = now()
  where user_id = v_uid;

  update public.leaderboard
  set display_name = v_name, updated_at = now()
  where user_id = v_uid;

  return jsonb_build_object('success', true, 'username', v_name, 'previous_username', v_old);
end;
$$;
revoke all on function public.rename_bobik_username(text) from public, anon;
grant execute on function public.rename_bobik_username(text) to authenticated;

-- RPCs run with database-owner rights so clients no longer need direct leaderboard writes.
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

-- Clients may read their own profile, but only the RPC above may change a nickname.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

-- Remove direct leaderboard writes; the validated SECURITY DEFINER RPC is the only writer.
revoke insert, update, delete on public.leaderboard from anon, authenticated;
grant select on public.leaderboard to anon, authenticated;

-- Creator status is not a client-controlled column. Clients can write only ordinary profile fields.
revoke all on public.public_profiles from anon, authenticated;
grant select on public.public_profiles to anon, authenticated;
grant insert (user_id, avatar, photo, bio, updated_at) on public.public_profiles to authenticated;
grant update (user_id, avatar, photo, bio, updated_at) on public.public_profiles to authenticated;

-- Existing row-level policies remain active and continue restricting writes to the owning user.
