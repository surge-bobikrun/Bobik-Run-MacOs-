import { createClient } from "npm:@supabase/supabase-js@2";

const OWNER_ID = "c517c2c5-60bc-4ba3-9670-49df6fa3602e";
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const publishable = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
    if (!url || !publishable) return json({ error: "Supabase configuration is missing" }, 500);

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Authentication required" }, 401);

    const userClient = createClient(url, publishable, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    const { data, error } = await userClient.auth.getUser();
    const user = data?.user;
    if (error || !user) return json({ error: "Invalid session" }, 401);
    if (user.id !== OWNER_ID) return json({ error: "Нет доступа" }, 403);

    return json({ error: "Старая админ-функция отключена. Используй основную admin-panel." }, 410);
  } catch (error) {
    console.error("bright-processor disabled endpoint:", error);
    return json({ error: "Internal server error" }, 500);
  }
});
