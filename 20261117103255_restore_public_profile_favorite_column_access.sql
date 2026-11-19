grant insert (favorite_character, favorite_vehicle) on table public.public_profiles to authenticated;
grant update (favorite_character, favorite_vehicle) on table public.public_profiles to authenticated;
alter table public.public_profiles enable row level security;
drop policy if exists "pp_insert_own" on public.public_profiles;
create policy "pp_insert_own" on public.public_profiles for insert to authenticated
with check ((select auth.uid()) = user_id);
drop policy if exists "pp_update_own" on public.public_profiles;
create policy "pp_update_own" on public.public_profiles for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
