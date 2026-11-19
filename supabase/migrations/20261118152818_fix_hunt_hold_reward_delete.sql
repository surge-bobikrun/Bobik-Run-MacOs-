-- Fix the live reward rollback: a case-sensitive patch left an unqualified
-- DELETE in the leaderboard trigger's hold reconciliation function.
-- user_id is a primary key and NOT NULL, so this preserves the intended cleanup.
do $migration$
declare
  v_function regprocedure;
  v_definition text;
begin
  foreach v_function in array array[
    'public.bobik_reconcile_hunt_leader_holds()'::regprocedure,
    'public.bobik_advance_global_hunt(uuid)'::regprocedure
  ] loop
    select pg_get_functiondef(v_function) into v_definition;
    v_definition := regexp_replace(
      v_definition,
      'DELETE[[:space:]]+FROM[[:space:]]+public\.bobik_hunt_all_categories_hold[[:space:]]*;',
      'DELETE FROM public.bobik_hunt_all_categories_hold WHERE user_id IS NOT NULL;',
      'gi'
    );
    if v_definition ~* 'DELETE[[:space:]]+FROM[[:space:]]+public\.bobik_hunt_all_categories_hold[[:space:]]*;' then
      raise exception 'Unfiltered hunt-hold DELETE remains in %', v_function;
    end if;
    execute v_definition;
  end loop;
end
$migration$;
