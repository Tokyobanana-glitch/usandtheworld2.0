-- Run this in the Supabase SQL Editor after 005_itinerary_owner_select.sql.
--
-- Editorial destination briefs for the Explore tab — "why go now," 4-6
-- notable places, rough daily cost, best months, every claim backed by a
-- real cited source (same sourcing discipline as api/_lib/generateAnswer.js:
-- live web search, cite what you used, omit what you can't verify rather
-- than guess). Generated weekly by a cron job (see
-- api/cron/check-watches.js), never per-request.
--
-- Public read: this is published content, same trust level as the
-- /explore verified-trips index — no RLS gate on who can see it. Writes are
-- service-role only (the cron job's own Supabase client bypasses RLS
-- entirely) — no insert/update/delete policy is added here, on purpose,
-- matching the itineraries/bucket_lists pattern of "server writes, RLS only
-- ever grants reads directly to the client."
create table if not exists explore_briefs (
  id uuid primary key default gen_random_uuid(),
  city text not null,
  country text,
  why_now text,
  highlights jsonb,
  price_level text,
  best_months text,
  sources jsonb,
  image_url text, -- left null for now; imagery is being generated separately
  generated_at timestamptz not null default now(),
  unique (city)
);

create index if not exists explore_briefs_generated_at_idx on explore_briefs (generated_at);

alter table explore_briefs enable row level security;

drop policy if exists "explore_briefs select all" on explore_briefs;
create policy "explore_briefs select all" on explore_briefs for select using (true);
