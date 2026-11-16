-- Harden profile-related SECURITY DEFINER functions; preserve authenticated flows.
create or replace function public.bobik_register_profile(p_username text)
returns void language plpgsql security definer set search_path = '' as $function$
declare n text:=lower(trim(p_username));
begin
 if auth.uid() is null then raise exception 'Not authenticated'; end if;
 if n !~ '^[[:alnum:]_-]{2,14}$' then raise exception 'Invalid username'; end if;
 insert into public.player_profiles(id,username,display_name) values(auth.uid(),n,p_username)
 on conflict(id) do update set display_name=excluded.display_name;
end;$function$;
create or replace function public.bobik_update_profile(p_display_name text,p_description text,p_avatar_url text)
returns void language plpgsql security definer set search_path = '' as $function$
begin
 if auth.uid() is null then raise exception 'Not authenticated'; end if;
 update public.player_profiles set display_name=left(coalesce(p_display_name,'Игрок'),14),description=left(coalesce(p_description,''),90),avatar_url=left(coalesce(p_avatar_url,''),200000) where id=auth.uid();
end;$function$;
create or replace function public.check_player_access()
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare s public.player_saves%rowtype;
begin
 if auth.uid() is null then raise exception 'Not authenticated'; end if;
 select * into s from public.player_saves where id=auth.uid();
 if not found then return jsonb_build_object('blocked',false); end if;
 if s.banned and (s.ban_until is null or s.ban_until>now()) then return jsonb_build_object('blocked',true,'until',s.ban_until); end if;
 if s.banned then update public.player_saves set banned=false,ban_until=null where id=auth.uid(); end if;
 return jsonb_build_object('blocked',false);
end;$function$;
revoke execute on function public.bobik_register_profile(text) from public,anon;
revoke execute on function public.bobik_update_profile(text,text,text) from public,anon;
revoke execute on function public.check_player_access() from public,anon;
revoke execute on function public.redeem_game_code(text) from public,anon;
revoke execute on function public.rename_bobik_username(text) from public,anon;
grant execute on function public.bobik_register_profile(text) to authenticated;
grant execute on function public.bobik_update_profile(text,text,text) to authenticated;
grant execute on function public.check_player_access() to authenticated;
grant execute on function public.redeem_game_code(text) to authenticated;
grant execute on function public.rename_bobik_username(text) to authenticated;
