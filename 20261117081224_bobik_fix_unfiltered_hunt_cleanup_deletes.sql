-- Fix safe-delete guard failures during run completion and global-hunt cleanup.
-- These are intentional whole-table cleanups of temporary hold rows; WHERE TRUE
-- makes the scope explicit while preserving the existing behavior.
do $migration$
declare
  v_def text;
begin
  select pg_get_functiondef('public.bobik_advance_global_hunt(uuid)'::regprocedure) into v_def;
  v_def := replace(v_def,
    'delete from public.bobik_hunt_all_categories_hold;',
    'delete from public.bobik_hunt_all_categories_hold where true;');
  execute v_def;

  select pg_get_functiondef('public.bobik_finish_run_for_user(uuid,uuid,integer,integer)'::regprocedure) into v_def;
  v_def := replace(v_def,
    'delete from public.bobik_hunt_leader_hold;',
    'delete from public.bobik_hunt_leader_hold where true;');
  execute v_def;

  select pg_get_functiondef('public.bobik_reconcile_hunt_leader_holds()'::regprocedure) into v_def;
  v_def := replace(v_def,
    'delete from public.bobik_hunt_all_categories_hold;',
    'delete from public.bobik_hunt_all_categories_hold where true;');
  execute v_def;
end
$migration$;
