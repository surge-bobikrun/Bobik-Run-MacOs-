-- Bobik Run v1.9.6 — richer live-round telemetry for the admin live view.
-- Adds lane position, chase-bar ratio, lives and a human-readable activity string
-- to game_live_state. All columns are nullable; older clients keep working.
alter table public.game_live_state
  add column if not exists lane_x real,
  add column if not exists gap_ratio real,
  add column if not exists lives smallint,
  add column if not exists activity text;

comment on column public.game_live_state.lane_x is 'Player lateral position on the road, -8.4..8.4 (self-reported telemetry).';
comment on column public.game_live_state.gap_ratio is 'Chase-bar ratio 0..1 (distance to the police).';
comment on column public.game_live_state.lives is 'Remaining lives in three-lives/hardcore/nightmare modes.';
comment on column public.game_live_state.activity is 'Short human-readable description of what the player is doing right now.';

-- Keep telemetry rows small: cap the activity string at the DB level too.
alter table public.game_live_state
  alter column activity type text;

-- Optional housekeeping: stale rows older than 1 hour are irrelevant for live view.
create index if not exists game_live_state_seen_at_idx on public.game_live_state(seen_at desc);
