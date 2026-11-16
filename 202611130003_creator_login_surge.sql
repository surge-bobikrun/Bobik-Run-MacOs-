-- Bobik Run v1.8.0 patch: creator identity is the login "surge".
-- Match the authoritative account login, not an old synthetic Auth email.
update public.public_profiles pp
set is_creator = true, updated_at = now()
from public.profiles p
where p.id = pp.user_id
  and lower(btrim(p.username)) = 'surge';

-- Keep the public profile username synchronized with the authoritative login.
update public.public_profiles pp
set username = p.username, updated_at = now()
from public.profiles p
where p.id = pp.user_id
  and lower(btrim(p.username)) = 'surge';
