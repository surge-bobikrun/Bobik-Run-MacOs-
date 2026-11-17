-- Bobik Run 1.9.4: five fixed sequential global hunts.
-- Existing accounts, saves, balances, XP and leaderboard rows are preserved.

alter table public.bobik_global_hunt_state
  add column if not exists sequence_index smallint not null default 1,
  add column if not exists objective text not null default 'Проедь 3 000 м в режиме «Кошмар»',
  add column if not exists icon text not null default '🌍',
  add column if not exists hold_hours integer not null default 5,
  add column if not exists is_completed boolean not null default false;

-- A player gets a hold timer only while they are #1 in every leaderboard category.
create table if not exists public.bobik_hunt_all_categories_hold (
  user_id uuid primary key references auth.users(id) on delete cascade,
  hunt_id uuid not null,
  held_since timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.bobik_hunt_all_categories_hold enable row level security;
revoke all on public.bobik_hunt_all_categories_hold from public, anon, authenticated;

-- The game has 4 modes. Nightmare exposes only its Hard difficulty tab;
-- the other three modes expose all three difficulties (10 categories total).
create or replace function public.bobik_reconcile_hunt_leader_holds()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_hunt public.bobik_global_hunt_state%rowtype;
  v_uid uuid;
  v_is_top_everywhere boolean;
begin
  select * into v_hunt from public.bobik_global_hunt_state where id = 1;
  if not found or v_hunt.sequence_index <> 5 or v_hunt.is_completed then
    delete from public.bobik_hunt_all_categories_hold;
    return;
  end if;

  for v_uid in select distinct user_id from public.leaderboard loop
    select not exists (
      select 1
      from (values
        (0::smallint,0::smallint),(0,1),(0,2),
        (1,0),(1,1),(1,2),
        (2,0),(2,1),(2,2),
        (3,2)
      ) as categories(mode,difficulty)
      where not exists (
        select 1 from public.leaderboard l
        where l.mode = categories.mode
          and l.difficulty = categories.difficulty
          and l.user_id = v_uid
          and l.user_id = (
            select top_row.user_id
            from public.leaderboard top_row
            where top_row.mode = categories.mode
              and top_row.difficulty = categories.difficulty
            order by top_row.best_distance desc, top_row.updated_at asc, top_row.user_id asc
            limit 1
          )
      )
    ) into v_is_top_everywhere;

    if v_is_top_everywhere then
      insert into public.bobik_hunt_all_categories_hold(user_id,hunt_id,held_since,updated_at)
      values(v_uid,v_hunt.hunt_id,now(),now())
      on conflict(user_id) do update
        set hunt_id = excluded.hunt_id,
            held_since = case when public.bobik_hunt_all_categories_hold.hunt_id = excluded.hunt_id
                              then public.bobik_hunt_all_categories_hold.held_since
                              else now() end,
            updated_at = now();
    else
      delete from public.bobik_hunt_all_categories_hold where user_id = v_uid;
    end if;
  end loop;

  delete from public.bobik_hunt_all_categories_hold h
  where not exists (select 1 from public.leaderboard l where l.user_id = h.user_id);
end;
$$;
revoke all on function public.bobik_reconcile_hunt_leader_holds() from public, anon, authenticated;

create or replace function public.bobik_leaderboard_hunt_hold_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.bobik_reconcile_hunt_leader_holds();
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.bobik_leaderboard_hunt_hold_trigger() from public, anon, authenticated;
drop trigger if exists bobik_leaderboard_hunt_hold_sync on public.leaderboard;
create trigger bobik_leaderboard_hunt_hold_sync
after insert or update or delete on public.leaderboard
for each row execute function public.bobik_leaderboard_hunt_hold_trigger();

-- Install the fixed first task without touching player data.
update public.bobik_global_hunt_state
set hunt_id = gen_random_uuid(), title = 'Кошмарный забег',
    target_distance = 3000, difficulty = 2, difficulty_stars = 9, mode = 3,
    sequence_index = 1, objective = 'Проедь 3 000 м в режиме «Кошмар»',
    icon = '🌑', hold_hours = 5, is_completed = false, created_at = now()
where id = 1;

create or replace function public.bobik_advance_global_hunt(p_expected_hunt_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_state public.bobik_global_hunt_state%rowtype;
  v_next_id uuid := gen_random_uuid();
begin
  select * into v_state from public.bobik_global_hunt_state where id = 1 for update;
  if not found or v_state.hunt_id <> p_expected_hunt_id then
    return jsonb_build_object('success',false,'stale',true);
  end if;
  if v_state.sequence_index >= 5 then
    update public.bobik_global_hunt_state
      set is_completed = true, title = 'Абсолютный чемпион: выполнено',
          objective = 'Все пять глобальных заданий завершены', created_at = now()
      where id = 1;
    delete from public.bobik_hunt_all_categories_hold;
    return jsonb_build_object('success',true,'completed',true,'sequence_index',5);
  end if;

  update public.bobik_global_hunt_state
  set hunt_id = v_next_id,
      sequence_index = v_state.sequence_index + 1,
      title = case v_state.sequence_index + 1
        when 2 then 'Испытание хардкора'
        when 3 then 'Большая дистанция'
        when 4 then 'Три жизни'
        else 'Абсолютный чемпион' end,
      target_distance = case v_state.sequence_index + 1
        when 2 then 5000 when 3 then 10000 when 4 then 6000 else 1000 end,
      mode = case v_state.sequence_index + 1
        when 2 then 2 when 3 then 0 when 4 then 1 else -1 end,
      difficulty = case when v_state.sequence_index + 1 = 5 then 2 else 1 end,
      difficulty_stars = case v_state.sequence_index + 1
        when 2 then 10 when 3 then 8 when 4 then 9 else 10 end,
      objective = case v_state.sequence_index + 1
        when 2 then 'Проедь 5 000 м в режиме «Хардкор»'
        when 3 then 'Проедь 10 000 м в обычном режиме'
        when 4 then 'Проедь 6 000 м в режиме «Три жизни»'
        else 'Займи 1-е место во всех 10 категориях таблицы лидеров одновременно и удерживай их 5 часов' end,
      icon = case v_state.sequence_index + 1
        when 2 then '🔥' when 3 then '🏁' when 4 then '💚' else '👑' end,
      hold_hours = 5, is_completed = false, created_at = now()
  where id = 1;

  if v_state.sequence_index + 1 = 5 then
    perform public.bobik_reconcile_hunt_leader_holds();
  else
    delete from public.bobik_hunt_all_categories_hold;
  end if;
  return jsonb_build_object('success',true,'completed_sequence',v_state.sequence_index,
    'sequence_index',v_state.sequence_index + 1,'hunt_id',v_next_id);
end;
$$;
revoke all on function public.bobik_advance_global_hunt(uuid) from public, anon, authenticated;

-- Called only by the trusted service-role run-finisher.
create or replace function public.bobik_process_global_hunt_run(p_user_id uuid,p_mode smallint,p_distance integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_state public.bobik_global_hunt_state%rowtype;
  v_hold public.bobik_hunt_all_categories_hold%rowtype;
begin
  if coalesce(nullif(current_setting('request.jwt.claim.role',true), ''), nullif(current_setting('request.jwt.claims',true), '')::jsonb ->> 'role') is distinct from 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;
  select * into v_state from public.bobik_global_hunt_state where id = 1 for update;
  if not found or v_state.is_completed then return jsonb_build_object('success',false,'inactive',true); end if;

  if v_state.sequence_index between 1 and 4 then
    if p_mode <> v_state.mode or p_distance < v_state.target_distance then
      return jsonb_build_object('success',false,'not_completed',true,'sequence_index',v_state.sequence_index);
    end if;
    insert into public.bobik_hunt_records(hunt_id,user_id,display_name,target_distance,actual_distance)
    select v_state.hunt_id,p_user_id,coalesce(p.username,'Игрок'),v_state.target_distance,p_distance
    from public.profiles p where p.id = p_user_id
    on conflict(hunt_id) do nothing;
    return public.bobik_advance_global_hunt(v_state.hunt_id);
  end if;

  perform public.bobik_reconcile_hunt_leader_holds();
  select * into v_hold from public.bobik_hunt_all_categories_hold where user_id = p_user_id and hunt_id = v_state.hunt_id;
  if found and v_hold.held_since <= now() - make_interval(hours => v_state.hold_hours) then
    insert into public.bobik_hunt_records(hunt_id,user_id,display_name,target_distance,actual_distance)
    select v_state.hunt_id,p_user_id,coalesce(p.username,'Игрок'),10,10
    from public.profiles p where p.id = p_user_id
    on conflict(hunt_id) do nothing;
    return public.bobik_advance_global_hunt(v_state.hunt_id);
  end if;
  return jsonb_build_object('success',false,'hold_in_progress',found,
    'hold_seconds',case when found then greatest(0,floor(extract(epoch from (now()-v_hold.held_since)))::integer) else 0 end);
end;
$$;
revoke all on function public.bobik_process_global_hunt_run(uuid,smallint,integer) from public, anon, authenticated;
grant execute on function public.bobik_process_global_hunt_run(uuid,smallint,integer) to service_role;

-- Preserve the currently deployed trusted run-finisher behavior,
-- then evaluate the current global objective inside the same database transaction.
create or replace function public.bobik_finish_run_for_user_v2(p_user_id uuid,p_run_id uuid,p_distance integer,p_elapsed_seconds integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_run public.bobik_run_sessions%rowtype;
  v_result jsonb;
  v_base numeric(18,4);
  v_allowed numeric(18,4);
  v_adjust numeric(18,4);
  v_state jsonb;
  v_hunt jsonb;
begin
  if coalesce(nullif(current_setting('request.jwt.claim.role',true), ''), nullif(current_setting('request.jwt.claims',true), '')::jsonb ->> 'role') is distinct from 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
  if p_user_id is null or p_run_id is null then raise exception 'RUN_REQUIRED'; end if;
  select * into v_run from public.bobik_run_sessions where id=p_run_id and user_id=p_user_id and status='started' for update;
  if not found then raise exception 'RUN_NOT_FOUND'; end if;
  if p_distance is null or p_distance<0 or p_distance>100000 then raise exception 'INVALID_SCORE'; end if;
  if p_elapsed_seconds is null or p_elapsed_seconds<1 or p_elapsed_seconds>10800 then raise exception 'INVALID_DURATION'; end if;
  v_base:=p_elapsed_seconds*(array[1.0,1.25,1.5,2.0])[v_run.mode+1];
  v_allowed:=least(p_elapsed_seconds,ceil(p_distance/20.0))*(array[1.0,1.25,1.5,2.0])[v_run.mode+1];
  v_adjust:=0;
  v_result:=public.bobik_finish_run_for_user(p_user_id,p_run_id,p_distance,p_elapsed_seconds);
  if v_adjust>0 then
    update public.bobik_player_economy set coins=greatest(0,coins-v_adjust),updated_at=now() where user_id=p_user_id;
    v_result:=jsonb_set(v_result,'{coins_awarded}',to_jsonb(greatest(0,coalesce((v_result->>'coins_awarded')::numeric,0)-v_adjust)),true);
    v_state:=public.bobik_get_state_for_user(p_user_id);
    v_result:=jsonb_set(v_result,'{state}',v_state,true);
  end if;
  v_hunt:=public.bobik_process_global_hunt_run(p_user_id,v_run.mode,p_distance);
  v_result:=jsonb_set(v_result,'{global_hunt}',coalesce(v_hunt,'{}'::jsonb),true);
  return v_result;
end;
$$;
revoke all on function public.bobik_finish_run_for_user_v2(uuid,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.bobik_finish_run_for_user_v2(uuid,uuid,integer,integer) to service_role;

-- Authenticated clients can read only the active hunt's public progress.
drop function if exists public.get_bobik_global_hunt_progress(uuid);
create function public.get_bobik_global_hunt_progress(p_hunt_id uuid)
returns table(user_id uuid,display_name text,best_distance integer,progress_percent numeric,
              completed boolean,attempts bigint,mode smallint,hold_seconds bigint)
language plpgsql security definer set search_path = '' as $$
declare
  v_hunt public.bobik_global_hunt_state%rowtype;
  v_hold public.bobik_hunt_all_categories_hold%rowtype;
begin
  select * into v_hunt from public.bobik_global_hunt_state where hunt_id=p_hunt_id for update;
  if not found then return; end if;
  if v_hunt.sequence_index = 5 then
    perform public.bobik_reconcile_hunt_leader_holds();
    select * into v_hold from public.bobik_hunt_all_categories_hold
      where hunt_id=p_hunt_id and held_since <= now()-make_interval(hours=>v_hunt.hold_hours)
      order by held_since asc limit 1;
    if found then
      insert into public.bobik_hunt_records(hunt_id,user_id,display_name,target_distance,actual_distance)
      select p_hunt_id,v_hold.user_id,coalesce(p.username,'Игрок'),10,10
      from public.profiles p where p.id=v_hold.user_id
      on conflict(hunt_id) do nothing;
      perform public.bobik_advance_global_hunt(p_hunt_id);
      return;
    end if;
    return query
      select h.user_id,coalesce(p.username,'Игрок')::text,10::integer,
        round(least(100::numeric,extract(epoch from (now()-h.held_since)) /
          greatest(v_hunt.hold_hours,1) / 3600 * 100),1),
        h.held_since <= now()-make_interval(hours=>v_hunt.hold_hours),
        0::bigint,(-1)::smallint,greatest(0,extract(epoch from (now()-h.held_since))::bigint)
      from public.bobik_hunt_all_categories_hold h
      join public.profiles p on p.id=h.user_id
      where h.hunt_id=p_hunt_id
      order by h.held_since asc;
  else
    return query
      select r.user_id,coalesce(p.username,'Игрок')::text,max(r.distance)::integer,
        round(least(100::numeric,max(r.distance)::numeric*100/greatest(1,v_hunt.target_distance)),1),
        max(r.distance)>=v_hunt.target_distance,count(*)::bigint,v_hunt.mode,0::bigint
      from public.run_history r join public.profiles p on p.id=r.user_id
      where r.created_at>=v_hunt.created_at and r.mode=v_hunt.mode
      group by r.user_id,p.username
      order by (max(r.distance)>=v_hunt.target_distance) desc,max(r.distance) desc
      limit 100;
  end if;
end;
$$;
revoke all on function public.get_bobik_global_hunt_progress(uuid) from public,anon;
grant execute on function public.get_bobik_global_hunt_progress(uuid) to authenticated;

comment on table public.bobik_hunt_all_categories_hold is 'Players continuously holding first place in all 10 leaderboard categories during global hunt 5.';
comment on column public.bobik_global_hunt_state.sequence_index is 'Current global hunt number, 1 through 5.';
