// Bobik Run — публичная конфигурация Supabase. Этот файл должен лежать рядом с index.html.
// Используется только publishable key; secret/service_role key здесь запрещён.
(function (w) {
  w.BOBIK_SUPABASE_URL = w.BOBIK_SUPABASE_URL || "https://nrmfygckxovwkkhvsywe.supabase.co";
  w.BOBIK_SUPABASE_ANON_KEY = w.BOBIK_SUPABASE_ANON_KEY || "sb_publishable_UZcS1P6Ucx8mXpSRj3l7XA_Dzu3h8IH";
  w.BOBIK_SUPABASE_PUBLISHABLE_KEY = w.BOBIK_SUPABASE_PUBLISHABLE_KEY || w.BOBIK_SUPABASE_ANON_KEY;
})(window);
