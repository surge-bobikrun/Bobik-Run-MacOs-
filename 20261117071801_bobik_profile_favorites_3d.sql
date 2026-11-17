alter table public.public_profiles
  add column if not exists favorite_character smallint not null default 0,
  add column if not exists favorite_vehicle smallint not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'public_profiles_favorite_character_range') then
    alter table public.public_profiles
      add constraint public_profiles_favorite_character_range check (favorite_character between 0 and 8);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'public_profiles_favorite_vehicle_range') then
    alter table public.public_profiles
      add constraint public_profiles_favorite_vehicle_range check (favorite_vehicle between 0 and 3);
  end if;
end $$;
