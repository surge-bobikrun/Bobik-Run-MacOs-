-- Bobik Run 1.8.0: allow longer profile descriptions (existing accounts/data remain intact).
alter table public.public_profiles
  drop constraint if exists public_profiles_bio_check;
alter table public.public_profiles
  add constraint public_profiles_bio_check
  check (bio is null or char_length(bio) <= 300);
