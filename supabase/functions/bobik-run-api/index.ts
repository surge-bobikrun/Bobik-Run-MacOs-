import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

async function readJsonLimited(req: Request, maxBytes: number): Promise<Record<string, unknown> | null> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("BODY_TOO_LARGE");
  if (!req.body) return null;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("BODY_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
}

function readKey(...values: (string | undefined)[]): string | null {
  for (const raw of values) {
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const candidate = parsed.default ?? Object.values(parsed)[0];
        if (typeof candidate === "string" && candidate.length > 20) return candidate;
        if (candidate && typeof candidate === "object") {
          const nested = (candidate as Record<string, unknown>).api_key ?? (candidate as Record<string, unknown>).key;
          if (typeof nested === "string") return nested;
        }
      }
    } catch {
      if (raw.length > 20) return raw;
    }
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ") || authorization.length > 8192) {
    return reply({ error: "Authentication required" }, 401);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const publishableKey = readKey(
    Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"),
    Deno.env.get("SUPABASE_ANON_KEY"),
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY")
  );
  const secretKey = readKey(
    Deno.env.get("SUPABASE_SECRET_KEYS"),
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  );
  if (!url || !publishableKey || !secretKey) {
    console.error("bobik-run-api: required server environment variables are missing");
    return reply({ error: "Server configuration unavailable" }, 500);
  }

  const authClient = createClient(url, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser();
  if (authError || !authData.user) return reply({ error: "Invalid session" }, 401);
  const bannedUntil = authData.user.banned_until;
  if (bannedUntil && Date.parse(bannedUntil) > Date.now()) {
    return reply({ error: "Account is temporarily blocked" }, 403);
  }

  let body: Record<string, unknown> | null = null;
  try { body = await readJsonLimited(req, 16 * 1024); }
  catch (error) {
    if (String((error as Error)?.message) === "BODY_TOO_LARGE") return reply({ error: "Request too large" }, 413);
    return reply({ error: "Invalid JSON" }, 400);
  }
  if (!body || typeof body.action !== "string") return reply({ error: "Invalid request" }, 400);

  const admin = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const userId = authData.user.id;

  if (body.action === "state") {
    const { data, error } = await admin.rpc("bobik_get_state_for_user", { p_user_id: userId });
    if (error) return reply({ error: error.message }, 400);
    return reply(data);
  }

  if (body.action === "start") {
    if (typeof body.mode !== "number" || !Number.isInteger(body.mode)
      || typeof body.difficulty !== "number" || !Number.isInteger(body.difficulty)) {
      return reply({ error: "Invalid category" }, 400);
    }
    const { data, error } = await admin.rpc("bobik_start_run_for_user", {
      p_user_id: userId, p_mode: body.mode, p_difficulty: body.difficulty,
    });
    if (error) return reply({ error: error.message }, 400);
    return reply({ run_id: data });
  }

  if (body.action === "finish") {
    if (typeof body.run_id !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.run_id)
      || typeof body.distance !== "number" || !Number.isInteger(body.distance)
      || typeof body.elapsed_seconds !== "number" || !Number.isInteger(body.elapsed_seconds)) {
      return reply({ error: "Invalid run result" }, 400);
    }
    const { data, error } = await admin.rpc("bobik_finish_run_for_user_v2", {
      p_user_id: userId, p_run_id: body.run_id,
      p_distance: body.distance, p_elapsed_seconds: body.elapsed_seconds,
    });
    if (error) return reply({ error: error.message }, 400);
    return reply(data);
  }

  if (body.action === "abort") {
    if (typeof body.run_id !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.run_id)) {
      return reply({ error: "Invalid run id" }, 400);
    }
    const { data, error } = await admin.rpc("bobik_abort_run_for_user", {
      p_user_id: userId, p_run_id: body.run_id,
    });
    if (error) return reply({ error: error.message }, 400);
    return reply({ aborted: !!data });
  }

  if (body.action === "purchase-item") {
    if ((body.kind !== "character" && body.kind !== "vehicle")
      || typeof body.item_id !== "number" || !Number.isInteger(body.item_id)) {
      return reply({ error: "Invalid item" }, 400);
    }
    const { data, error } = await admin.rpc("bobik_purchase_item_for_user", {
      p_user_id: userId, p_kind: body.kind, p_item_id: body.item_id,
    });
    if (error) return reply({ error: error.message }, 400);
    const state=await admin.rpc("bobik_get_state_for_user",{p_user_id:userId});
    if(state.error)console.warn("bobik-run-api: purchase succeeded but state refresh failed",state.error.message);
    return reply({result:data,state:state.error?null:state.data,state_sync_pending:!!state.error});
  }

  if (body.action === "select-item") {
    if ((body.kind !== "character" && body.kind !== "vehicle")
      || typeof body.item_id !== "number" || !Number.isInteger(body.item_id)) {
      return reply({ error: "Invalid item" }, 400);
    }
    const { data, error } = await admin.rpc("bobik_select_item_for_user", {
      p_user_id: userId, p_kind: body.kind, p_item_id: body.item_id,
    });
    if (error) return reply({ error: error.message }, 400);
    const state=await admin.rpc("bobik_get_state_for_user",{p_user_id:userId});
    if(state.error)console.warn("bobik-run-api: selection succeeded but state refresh failed",state.error.message);
    return reply({result:data,state:state.error?null:state.data,state_sync_pending:!!state.error});
  }

  if (body.action === "purchase-upgrade") {
    const maxIndex=body.kind==="character"?8:body.kind==="vehicle"?3:-1;
    if ((body.kind !== "character" && body.kind !== "vehicle")
      || typeof body.index !== "number" || !Number.isInteger(body.index) || body.index<0 || body.index>maxIndex
      || !(body.stat==="speed" || body.stat==="maneuver" || body.stat==="resistance")) {
      return reply({ error: "Invalid upgrade" }, 400);
    }
    const { data, error } = await admin.rpc("bobik_purchase_upgrade_for_user", {
      p_user_id: userId, p_kind: body.kind, p_index: body.index, p_stat: body.stat,
    });
    if (error) return reply({ error: error.message }, 400);
    const state=await admin.rpc("bobik_get_state_for_user",{p_user_id:userId});
    if(state.error)console.warn("bobik-run-api: upgrade succeeded but state refresh failed",state.error.message);
    return reply({result:data,state:state.error?null:state.data,state_sync_pending:!!state.error});
  }

  return reply({ error: "Unknown action" }, 400);
});
