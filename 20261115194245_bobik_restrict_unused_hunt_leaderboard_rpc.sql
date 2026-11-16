-- The UI now uses per-hunt progress; do not expose user UUIDs through this unused aggregate RPC.
revoke all on function public.get_bobik_hunt_leaderboard() from public, anon, authenticated;
grant execute on function public.get_bobik_hunt_leaderboard() to service_role;
