-- Run this in the Supabase SQL Editor after 001 (schema.sql) is already applied.
-- Adds two independent features:
--   creator_clips — your own footage, attached to a stop by the SAME identity
--     key the geocoder resolves that place to (see geocodeCacheKey in
--     api/_lib/geocode.js). Public read (it's your own published content),
--     write restricted to service_role (added only via scripts/add-creator-clip.mjs).
--   trip_watch     — opt-in email subscriptions to a saved trip's re-verify
--     diff. A watcher is tied to a slug, not a person/account (no auth yet).

-- cache_key is unique by design: one clip per place. Re-tagging a place
-- (scripts/add-creator-clip.mjs upserts on this column) replaces the
-- previous clip rather than creating a second row for the same place.
create table if not exists creator_clips (
  id uuid primary key default gen_random_uuid(),
  cache_key text not null unique,   -- matches geocode_cache.cache_key for the same place
  video_url text not null,          -- link to your clip (YouTube/IG/TikTok short, etc.)
  caption text,                     -- shown as the link text; falls back to a generic label if empty
  created_at timestamptz not null default now()
);

create index if not exists creator_clips_key_idx on creator_clips (cache_key);

alter table creator_clips enable row level security;

-- Public read: this is your own published content, safe for anyone to see.
-- (Postgres has no CREATE POLICY IF NOT EXISTS — drop-then-create is the
-- standard idempotent pattern, safe to re-run.)
drop policy if exists "creator_clips public read" on creator_clips;
create policy "creator_clips public read"
  on creator_clips for select
  using (true);

-- No insert/update/delete policy for anon/authenticated — writes only ever
-- happen via scripts/add-creator-clip.mjs using the service_role key, which
-- bypasses RLS unconditionally.

create table if not exists trip_watch (
  id uuid primary key default gen_random_uuid(),
  slug text not null references itineraries(slug) on delete cascade,
  email text not null,
  unsubscribe_token text not null unique,
  created_at timestamptz not null default now(),
  last_notified_at timestamptz,
  unsubscribed_at timestamptz
);

create index if not exists trip_watch_slug_idx on trip_watch (slug);
create unique index if not exists trip_watch_slug_email_idx on trip_watch (slug, email);

alter table trip_watch enable row level security;
-- Deny-all for anon/authenticated — writes go through api/trip-watch.js and
-- reads only ever happen from api/cron/check-watches.js, both using
-- service_role. An email address is not something the anon key should ever
-- be able to list.
