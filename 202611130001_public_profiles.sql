-- Bobik Run 1.7.9: публичный профиль (имя, аватарка, описание) для таблицы лидеров. Выполнить в SQL Editor.
create table if not exists public.public_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null default 'Игрок' check (char_length(username) between 1 and 24),
  avatar smallint not null default 0 check (avatar between 0 and 200),
  photo text check (photo is null or (char_length(photo) <= 60000 and photo ~ '^data:image/(jpeg|png);base64,[A-Za-z0-9+/=]+$')),
  bio text check (bio is null or char_length(bio) <= 90),
  updated_at timestamptz not null default now()
);
alter table public.public_profiles enable row level security;
revoke all on public.public_profiles from anon, authenticated;
grant select on public.public_profiles to anon, authenticated;
grant insert, update on public.public_profiles to authenticated;
drop policy if exists "pp_read" on public.public_profiles;
create policy "pp_read" on public.public_profiles for select to anon, authenticated using (true);
drop policy if exists "pp_insert_own" on public.public_profiles;
create policy "pp_insert_own" on public.public_profiles for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "pp_update_own" on public.public_profiles;
create policy "pp_update_own" on public.public_profiles for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
insert into public.public_profiles(user_id, username) select id, username from public.profiles on conflict (user_id) do nothing;

-- Сменить админ-код (хранится только SHA-256). Подставь свой код вместо МОЙ_КОД и выполни:
-- insert into public.bobik_private_config(key, value) values ('admin_code_sha256', encode(sha256(convert_to('МОЙ_КОД','UTF8')),'hex'))
--   on conflict (key) do update set value = excluded.value;
