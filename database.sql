-- Bobik Run: cloud saves, redeem codes, admin moderation, leaderboards
create table if not exists public.player_saves (
 id uuid primary key references auth.users(id) on delete cascade,
 username text not null default 'Игрок',
 save_data jsonb not null default '{}'::jsonb,
 banned boolean not null default false,
 ban_until timestamptz,
 updated_at timestamptz not null default now()
);
alter table public.player_saves add column if not exists banned boolean not null default false;
alter table public.player_saves add column if not exists ban_until timestamptz;
alter table public.player_saves enable row level security;
grant select, insert, update on public.player_saves to authenticated;
drop policy if exists "Players read own save" on public.player_saves;
create policy "Players read own save" on public.player_saves for select to authenticated using (auth.uid()=id);
drop policy if exists "Players insert own save" on public.player_saves;
create policy "Players insert own save" on public.player_saves for insert to authenticated with check (auth.uid()=id);
drop policy if exists "Players update own save" on public.player_saves;
create policy "Players update own save" on public.player_saves for update to authenticated using (auth.uid()=id) with check (auth.uid()=id);

create table if not exists public.admin_users(user_id uuid primary key references auth.users(id) on delete cascade, created_at timestamptz default now());
create table if not exists public.redeemed_codes(user_id uuid references auth.users(id) on delete cascade, code_key text not null, redeemed_at timestamptz default now(), primary key(user_id,code_key));
create table if not exists public.leaderboard_scores(
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 username text not null,
 mode smallint not null check(mode between 0 and 2),
 difficulty smallint not null check(difficulty between 0 and 2),
 score integer not null check(score between 0 and 100000),
 created_at timestamptz not null default now(),
 unique(user_id,mode,difficulty)
);
alter table public.leaderboard_scores enable row level security;
grant select, insert, update on public.leaderboard_scores to authenticated;
drop policy if exists "Leaderboard is public" on public.leaderboard_scores;
create policy "Leaderboard is public" on public.leaderboard_scores for select using(true);
drop policy if exists "Player writes own leaderboard row" on public.leaderboard_scores;
create policy "Player writes own leaderboard row" on public.leaderboard_scores for all to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id);

-- Codes are checked on the server, never embedded in the public game client.
create or replace function public.redeem_bobik_code(p_code text)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare uid uuid:=auth.uid(); c text:=lower(trim(p_code)); reward integer;
begin
 if uid is null then raise exception 'Нужно войти в аккаунт'; end if;
 if c='admin&+panel7767' then
   insert into public.admin_users(user_id) values(uid) on conflict do nothing;
   return jsonb_build_object('kind','admin','message','Доступ к панели администратора открыт');
 elsif c='bobikfree' then reward:=200;
 elsif c='bobiksecret' then reward:=500;
 else raise exception 'Неверный код'; end if;
 insert into public.redeemed_codes(user_id,code_key) values(uid,c) on conflict do nothing;
 if not found then raise exception 'Этот код уже использован'; end if;
 update public.player_saves set save_data=jsonb_set(save_data,'{c}',to_jsonb(coalesce((save_data->>'c')::integer,0)+reward),true),updated_at=now() where id=uid;
 return jsonb_build_object('kind','coins','reward',reward);
end $$;
revoke all on function public.redeem_bobik_code(text) from public;
grant execute on function public.redeem_bobik_code(text) to authenticated;

create or replace function public.admin_list_players()
returns table(user_id uuid,email text,username text,banned boolean,ban_until timestamptz,updated_at timestamptz)
language plpgsql security definer set search_path=public,auth as $$
begin
 if not exists(select 1 from public.admin_users a where a.user_id=auth.uid()) then raise exception 'Нет прав администратора'; end if;
 return query select u.id,u.email,coalesce(s.username,'Игрок'),coalesce(s.banned,false),s.ban_until,s.updated_at from auth.users u left join public.player_saves s on s.id=u.id order by s.updated_at desc nulls last;
end $$;
revoke all on function public.admin_list_players() from public;
grant execute on function public.admin_list_players() to authenticated;

create or replace function public.admin_set_player_status(p_user uuid,p_banned boolean,p_until timestamptz default null)
returns void language plpgsql security definer set search_path=public,auth as $$
begin
 if not exists(select 1 from public.admin_users a where a.user_id=auth.uid()) then raise exception 'Нет прав администратора'; end if;
 if p_user=auth.uid() then raise exception 'Нельзя изменить собственный аккаунт'; end if;
 update public.player_saves set banned=p_banned,ban_until=case when p_banned then p_until else null end,updated_at=now() where id=p_user;
end $$;
revoke all on function public.admin_set_player_status(uuid,boolean,timestamptz) from public;
grant execute on function public.admin_set_player_status(uuid,boolean,timestamptz) to authenticated;

create or replace function public.check_player_access()
returns jsonb language plpgsql security definer set search_path=public as $$
declare s public.player_saves%rowtype;
begin
 select * into s from public.player_saves where id=auth.uid();
 if not found then return jsonb_build_object('blocked',false); end if;
 if s.banned and (s.ban_until is null or s.ban_until>now()) then return jsonb_build_object('blocked',true,'until',s.ban_until); end if;
 if s.banned then update public.player_saves set banned=false,ban_until=null where id=auth.uid(); end if;
 return jsonb_build_object('blocked',false);
end $$;
revoke all on function public.check_player_access() from public;
grant execute on function public.check_player_access() to authenticated;

create or replace function public.is_bobik_admin()
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.admin_users where user_id=auth.uid());
$$;
revoke all on function public.is_bobik_admin() from public;
grant execute on function public.is_bobik_admin() to authenticated;

create or replace function public.submit_bobik_score(p_mode smallint,p_difficulty smallint,p_score integer,p_username text)
returns void language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null then raise exception 'Нужно войти в аккаунт'; end if;
 if p_mode not between 0 and 2 or p_difficulty not between 0 and 2 or p_score not between 0 and 100000 then raise exception 'Некорректный результат'; end if;
 insert into public.leaderboard_scores(user_id,username,mode,difficulty,score)
 values(auth.uid(),left(coalesce(nullif(trim(p_username),''),'Игрок'),14),p_mode,p_difficulty,p_score)
 on conflict(user_id,mode,difficulty) do update set score=greatest(public.leaderboard_scores.score,excluded.score),username=excluded.username,created_at=now();
end $$;
revoke all on function public.submit_bobik_score(smallint,smallint,integer,text) from public;
grant execute on function public.submit_bobik_score(smallint,smallint,integer,text) to authenticated;
revoke insert,update,delete on public.leaderboard_scores from authenticated;
-- Prevent players from editing moderation fields on their own save row.
revoke update on public.player_saves from authenticated;
grant update(username,save_data,updated_at) on public.player_saves to authenticated;
grant select on public.leaderboard_scores to anon;
