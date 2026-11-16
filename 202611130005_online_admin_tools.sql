create table if not exists public.online_presence (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null default 'Игрок',
  last_seen timestamptz not null default now()
);
alter table public.online_presence enable row level security;
revoke all on public.online_presence from anon, authenticated;
grant insert, update, delete, select on public.online_presence to authenticated;
drop policy if exists "users manage own online presence" on public.online_presence;
create policy "users manage own online presence" on public.online_presence for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table if not exists public.global_messages (
  id bigint generated always as identity primary key,
  message text not null check (char_length(message) between 1 and 240),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);
alter table public.global_messages enable row level security;
revoke all on public.global_messages from anon, authenticated;
grant select on public.global_messages to anon, authenticated;
drop policy if exists "everyone can read global messages" on public.global_messages;
create policy "everyone can read global messages" on public.global_messages for select to anon, authenticated using (true);

create table if not exists public.game_interrupts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  message text not null check (char_length(message) between 1 and 160),
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz
);
create index if not exists game_interrupts_user_created_idx on public.game_interrupts(user_id, created_at desc);
alter table public.game_interrupts enable row level security;
revoke all on public.game_interrupts from anon, authenticated;
grant select, update on public.game_interrupts to authenticated;
drop policy if exists "users read own game interrupts" on public.game_interrupts;
create policy "users read own game interrupts" on public.game_interrupts for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "users acknowledge own game interrupts" on public.game_interrupts;
create policy "users acknowledge own game interrupts" on public.game_interrupts for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

alter table public.global_messages replica identity full;
alter table public.game_interrupts replica identity full;
do $$ begin
 if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='global_messages') then alter publication supabase_realtime add table public.global_messages; end if;
 if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='game_interrupts') then alter publication supabase_realtime add table public.game_interrupts; end if;
end $$;
