-- Supabase SQL Editor -> New query -> вставь весь файл -> Run
create table if not exists public.player_saves (
 id uuid primary key references auth.users(id) on delete cascade,
 username text not null default 'Игрок',
 save_data jsonb not null default '{}'::jsonb,
 updated_at timestamptz not null default now()
);
alter table public.player_saves enable row level security;
grant select, insert, update on public.player_saves to authenticated;
drop policy if exists "Players read own save" on public.player_saves;
create policy "Players read own save" on public.player_saves for select to authenticated using (auth.uid()=id);
drop policy if exists "Players insert own save" on public.player_saves;
create policy "Players insert own save" on public.player_saves for insert to authenticated with check (auth.uid()=id);
drop policy if exists "Players update own save" on public.player_saves;
create policy "Players update own save" on public.player_saves for update to authenticated using (auth.uid()=id) with check (auth.uid()=id);
