import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function readKeySet(name: string): Record<string, string> {
  try { return JSON.parse(Deno.env.get(name) ?? "{}"); }
  catch { return {}; }
}

function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aa = enc.encode(a);
  const bb = enc.encode(b);
  let diff = aa.length ^ bb.length;
  const n = Math.max(aa.length, bb.length);
  for (let i = 0; i < n; i++) diff |= (aa[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const publishable = readKeySet("SUPABASE_PUBLISHABLE_KEYS").default
      ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")
      ?? Deno.env.get("SUPABASE_ANON_KEY");
    const secret = readKeySet("SUPABASE_SECRET_KEYS").default
      ?? Deno.env.get("SUPABASE_SECRET_KEY")
      ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !publishable || !secret) return json({ error: "Supabase function secrets are not configured" }, 500);

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Authentication required" }, 401);
    const userClient = createClient(url, publishable, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    const user = userData?.user;
    if (userError || !user) return json({ error: "Invalid or expired session" }, 401);

    const admin = createClient(url, secret, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    const body = await req.json().catch(() => ({}));
    const action = typeof body?.action === "string" ? body.action : "";

    if (action === "activate") {
      const supplied = typeof body?.code === "string" ? body.code.trim() : "";
      const { data: config, error: configError } = await admin.from("bobik_private_config")
        .select("value").eq("key", "admin_code_sha256").maybeSingle();
      if (configError) throw configError;
      const expectedHash = typeof config?.value === "string" ? config.value.trim().toLowerCase() : "";
      if (!/^[a-f0-9]{64}$/.test(expectedHash)) {
        return json({ error: "Admin code hash is not configured in private config" }, 503);
      }
      if (!constantTimeEqual(await sha256Hex(supplied), expectedHash)) {
        return json({ success: false, is_admin: false });
      }
      const { error } = await admin.from("user_roles").upsert({ user_id: user.id, role: "admin" }, { onConflict: "user_id" });
      if (error) throw error;
      return json({ success: true, is_admin: true });
    }

    const { data: role, error: roleError } = await admin.from("user_roles")
      .select("role").eq("user_id", user.id).maybeSingle();
    if (roleError) throw roleError;
    if (role?.role !== "admin") return json({ error: "Нет доступа к админ-панели" }, 403);

    if (action === "list") {
      const { data: profiles, error: profilesError } = await admin.from("profiles")
        .select("id, username").order("created_at", { ascending: true });
      if (profilesError) throw profilesError;

      const authUsers = [];
      for (let page = 1; page <= 20; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) throw error;
        const batch = data?.users ?? [];
        authUsers.push(...batch);
        if (batch.length < 1000) break;
      }
      const userById = new Map(authUsers.map((u: any) => [u.id, u]));
      const result = (profiles ?? []).map((p: any) => {
        const authUser: any = userById.get(p.id);
        const bannedUntil = authUser?.banned_until ?? null;
        return {
          id: p.id,
          username: p.username || authUser?.user_metadata?.username || "Игрок",
          banned: !!bannedUntil && new Date(bannedUntil).getTime() > Date.now(),
          banned_until: bannedUntil,
        };
      });
      return json({ users: result });
    }

    if (action === "coins") {
      const amount = Math.floor(Number(body?.amount));
      if (!Number.isFinite(amount) || amount < 1 || amount > 1_000_000_000) return json({ error: "Некорректное число монет" }, 400);
      const { data: row, error: readError } = await admin.from("game_saves").select("data").eq("user_id", user.id).maybeSingle();
      if (readError) throw readError;
      const save = { ...(row?.data ?? { ov: [0], vh: 0 }) } as Record<string, unknown>;
      save.c = Math.min(1_000_000_000_000, Math.max(0, Number(save.c ?? 60)) + amount);
      const { error } = await admin.from("game_saves").upsert({ user_id: user.id, data: save, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (error) throw error;
      return json({ success: true, coins: save.c, save });
    }

    if (action === "ban" || action === "unban") {
      const targetId = typeof body?.user_id === "string" ? body.user_id : "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetId)) {
        return json({ error: "Некорректный ID аккаунта" }, 400);
      }
      if (targetId === user.id) return json({ error: "Нельзя заблокировать собственный аккаунт" }, 400);
      const hours = Math.min(876000, Math.max(1, Math.round(Number(body?.hours) || 24)));
      const { error } = await admin.auth.admin.updateUserById(targetId, {
        ban_duration: action === "ban" ? `${hours}h` : "none",
      });
      if (error) throw error;
      return json({ success: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error("admin-panel error:", error);
    return json({ error: error instanceof Error ? error.message : "Internal server error" }, 500);
  }
});
