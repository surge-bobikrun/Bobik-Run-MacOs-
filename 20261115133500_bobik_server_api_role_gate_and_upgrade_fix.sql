-- Bobik Run v1.9.0 follow-up: repair the server-only Supabase RPC gate.
--
-- These SECURITY DEFINER routines are executable only by service_role (explicit ACLs
-- below). Checking request.jwt.claim.role inside the function is incompatible with
-- the project's current server API key flow and caused SERVICE_ROLE_REQUIRED for
-- valid calls coming from bobik-run-api (HTTP 400 on state/start/finish/purchases).
-- Keep the database privilege boundary; remove only the duplicate JWT-claim test.

DO $migration$
DECLARE
  r record;
  v_definition text;
  v_updated integer := 0;
  v_guard text := 'if current_setting(''request.jwt.claim.role'',true) is distinct from ''service_role'' then raise exception ''SERVICE_ROLE_REQUIRED''; end if;';
  v_names text[] := ARRAY[
    'bobik_abort_run_for_user',
    'bobik_default_quest_data',
    'bobik_finish_run_for_user',
    'bobik_finish_run_for_user_v2',
    'bobik_get_state_for_user',
    'bobik_purchase_item_for_user',
    'bobik_purchase_upgrade_for_user',
    'bobik_select_item_for_user',
    'bobik_start_run_for_user',
    'bobik_update_quest_tasks'
  ];
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY(v_names)
      AND p.prosrc LIKE '%request.jwt.claim.role%'
    ORDER BY p.proname
  LOOP
    v_definition := pg_get_functiondef(r.oid);
    IF position(v_guard IN v_definition) > 0 THEN
      v_definition := replace(
        v_definition,
        v_guard,
        '-- Caller authorization is enforced by EXECUTE grants to service_role only.'
      );
    ELSE
      -- Some bodies format the same test across multiple lines.
      v_definition := regexp_replace(
        v_definition,
        'if current_setting\(''request\.jwt\.claim\.role'',\s*true\)\s+is distinct from\s+''service_role''\s+then\s+raise exception\s+''SERVICE_ROLE_REQUIRED'';\s+end if;',
        '-- Caller authorization is enforced by EXECUTE grants to service_role only.',
        'gi'
      );
    END IF;
    IF v_definition = pg_get_functiondef(r.oid) THEN
      RAISE EXCEPTION 'Expected role guard not found in public.%', r.proname;
    END IF;
    EXECUTE v_definition;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.oid::regprocedure);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.oid::regprocedure);
    v_updated := v_updated + 1;
  END LOOP;

  IF v_updated <> array_length(v_names, 1) THEN
    RAISE EXCEPTION 'Expected to patch % server RPCs, patched %; check the live schema before applying',
      array_length(v_names, 1), v_updated;
  END IF;
END;
$migration$;

-- Upgrades are attached to the selected shop preview, so allow any owned item,
-- not only the item currently equipped. Ownership, bounds, wallet and level remain
-- enforced atomically under a row lock.
CREATE OR REPLACE FUNCTION public.bobik_purchase_upgrade_for_user(
  p_user_id uuid,
  p_kind text,
  p_index integer,
  p_stat text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_e public.bobik_player_economy%rowtype;
  v_doc jsonb;
  v_item_doc jsonb;
  v_level_text text;
  v_level integer;
  v_cost integer;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'USER_REQUIRED'; END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('character','vehicle') THEN RAISE EXCEPTION 'INVALID_KIND'; END IF;
  IF p_index IS NULL THEN RAISE EXCEPTION 'INVALID_ITEM'; END IF;
  IF p_stat IS NULL OR p_stat NOT IN ('speed','maneuver','resistance') THEN RAISE EXCEPTION 'INVALID_STAT'; END IF;

  SELECT * INTO v_e
  FROM public.bobik_player_economy
  WHERE user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WALLET_NOT_FOUND'; END IF;

  IF p_kind = 'character' THEN
    IF p_index NOT BETWEEN 0 AND 8 OR NOT coalesce(p_index = ANY(v_e.owned_characters), false) THEN
      RAISE EXCEPTION 'INVALID_CHARACTER';
    END IF;
    v_doc := coalesce(v_e.character_upgrades, '{}'::jsonb);
  ELSE
    IF p_index NOT BETWEEN 0 AND 3 OR NOT coalesce(p_index = ANY(v_e.owned_vehicles), false) THEN
      RAISE EXCEPTION 'INVALID_VEHICLE';
    END IF;
    v_doc := coalesce(v_e.vehicle_upgrades, '{}'::jsonb);
  END IF;

  v_item_doc := coalesce(v_doc -> p_index::text, '{}'::jsonb);
  IF jsonb_typeof(v_item_doc) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'INVALID_UPGRADE_STATE';
  END IF;
  v_level_text := v_item_doc ->> p_stat;
  IF v_level_text IS NOT NULL AND v_level_text !~ '^[0-5]$' THEN
    RAISE EXCEPTION 'INVALID_UPGRADE_STATE';
  END IF;
  v_level := coalesce(v_level_text::integer, 0);
  IF v_level >= 5 THEN RAISE EXCEPTION 'MAX_LEVEL'; END IF;

  v_cost := 250 * (v_level + 1);
  IF v_e.coins < v_cost THEN RAISE EXCEPTION 'INSUFFICIENT_COINS'; END IF;

  v_doc := jsonb_set(
    v_doc,
    ARRAY[p_index::text],
    v_item_doc || jsonb_build_object(p_stat, v_level + 1),
    true
  );

  UPDATE public.bobik_player_economy
  SET coins = coins - v_cost,
      character_upgrades = CASE WHEN p_kind = 'character' THEN v_doc ELSE character_upgrades END,
      vehicle_upgrades = CASE WHEN p_kind = 'vehicle' THEN v_doc ELSE vehicle_upgrades END,
      updated_at = now()
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'coins_spent', v_cost,
    'upgrade_level', v_level + 1
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.bobik_purchase_upgrade_for_user(uuid,text,integer,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bobik_purchase_upgrade_for_user(uuid,text,integer,text) TO service_role;
