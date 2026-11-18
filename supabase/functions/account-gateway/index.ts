import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function readKeySet(name: string): Record<string, string> {
  try { return JSON.parse(Deno.env.get(name) ?? "{}"); }
  catch { return {}; }
}

async function readJsonLimited(req: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("BODY_TOO_LARGE");
  if (!req.body) return {};
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
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function normalizeUsername(value: unknown): string {
  return String(value ?? "").normalize("NFKC").trim().toLowerCase();
}

function constantTimeEqual(a: string, b: string): boolean {
  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  let diff = aa.length ^ bb.length;
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) diff |= (aa[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const publishable = Deno.env.get("BOBIK_PUBLIC_KEY")
      ?? readKeySet("SUPABASE_PUBLISHABLE_KEYS").default
      ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")
      ?? Deno.env.get("SUPABASE_ANON_KEY");
    const acceptedApiKeys = [
      publishable,
      Deno.env.get("BOBIK_PUBLIC_KEY"),
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY"),
      Deno.env.get("SUPABASE_ANON_KEY"),
    ].filter((value): value is string => !!value);
    const secret = readKeySet("SUPABASE_SECRET_KEYS").default
      ?? Deno.env.get("SUPABASE_SECRET_KEY")
      ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !publishable || !secret) return json({ error: "Supabase function secrets are not configured" }, 500);

    // This endpoint is intentionally callable before login. Verify the project API key
    // ourselves because verify_jwt is disabled for the username-to-account login flow.
    const apiKey = req.headers.get("apikey") ?? "";
    if (apiKey.length > 512 || !acceptedApiKeys.some((candidate) => constantTimeEqual(apiKey, candidate))) {
      return json({ error: "Invalid API key" }, 401);
    }

    let body: any;
    try { body = await readJsonLimited(req, 8 * 1024); }
    catch (error) {
      if (String((error as Error)?.message) === "BODY_TOO_LARGE") return json({ error: "Request too large" }, 413);
      return json({ error: "Invalid JSON body" }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body) || body?.action !== "sign-in") return json({ error: "Unknown action" }, 400);

    const username = normalizeUsername(body?.username);
    const password = typeof body?.password === "string" ? body.password : "";
    if (username.length < 2 || username.length > 24 || password.length < 6 || password.length > 72) {
      return json({ error: "Неверное имя игрока или пароль." }, 401);
    }

    const admin = createClient(url, secret, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    const { data: profile, error: profileError } = await admin.from("profiles")
      .select("id").eq("username_key", username).maybeSingle();
    if (profileError) throw profileError;
    if (!profile?.id) return json({ error: "Неверное имя игрока или пароль." }, 401);

    const { data: authUser, error: authUserError } = await admin.auth.admin.getUserById(profile.id);
    if (authUserError || !authUser?.user?.email) {
      return json({ error: "Неверное имя игрока или пароль." }, 401);
    }

    // The Auth email is used only for server-side account lookup and password
    // verification. The game UI continues to work with the normal Supabase session.
    const authClient = createClient(url, publishable, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    const { data, error } = await authClient.auth.signInWithPassword({
      email: authUser.user.email,
      password,
    });
    if (error || !data?.session) return json({ error: "Неверное имя игрока или пароль." }, 401);

    return json({ session: data.session });
  } catch (error) {
    console.error("account-gateway error:", error);
    return json({ error: "Не удалось выполнить вход. Попробуй ещё раз." }, 500);
  }
});
