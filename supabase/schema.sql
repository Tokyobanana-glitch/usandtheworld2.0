-- Run this in the Supabase SQL Editor (Project -> SQL Editor -> New query).
-- Two tables with deliberately different lifecycles:
--   geocode_cache — permanent. Place identity is shared across every
--     itinerary ever generated, so a landmark is looked up once, globally,
--     forever. Coordinates don't go stale.
--   itineraries   — a saved-trip store, not a query cache. A slug lookup
--     always serves the saved payload; the 14-day expiry only gates whether
--     a NEW free-text query is allowed to match an EXISTING row instead of
--     regenerating. See api/_lib/itineraryStore.js and api/trip-page.js.

create extension if not exists pgcrypto;

create table if not exists geocode_cache (
  id uuid primary key default gen_random_uuid(),
  -- normalize(searchName) || '|' || normalize(locality-or-city) || '|' || countryCode (ISO2, or 'unknown')
  cache_key text not null unique,
  lat double precision not null,
  lng double precision not null,
  provider text not null,      -- 'mapbox' | 'wikidata' | 'geoapify'
  rung text not null,          -- e.g. 'searchName', 'normalizedName+city', 'search'
  resolved_at timestamptz not null default now()
);

create index if not exists geocode_cache_key_idx on geocode_cache (cache_key);

create table if not exists itineraries (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  query text not null,              -- original, as typed
  normalized_query text not null,   -- trim/lowercase/whitespace-collapsed, cache-matching key only
  payload jsonb not null,           -- full API response: destination, answer, itinerary (with stops+legs), sources, etc.
  schema_version integer not null default 1,  -- payload shape version; see CURRENT_SCHEMA_VERSION in itineraryStore.js
  created_at timestamptz not null default now(),
  verified_at timestamptz not null default now(),
  owner text,                       -- nullable; no auth yet, reserved for later
  source_slug text references itineraries(slug)  -- set when this row is a re-verified version of an earlier one
);

create index if not exists itineraries_slug_idx on itineraries (slug);
create index if not exists itineraries_normalized_query_idx on itineraries (normalized_query);
create index if not exists itineraries_source_slug_idx on itineraries (source_slug);

-- Already-provisioned databases won't pick up the column from create table
-- (it's a no-op once the table exists), so add it explicitly and idempotently.
alter table itineraries add column if not exists schema_version integer not null default 1;

-- Enable RLS with zero policies: deny-all for anon/authenticated, and no
-- effect on our own server code, which exclusively uses the service_role key
-- (service_role bypasses RLS unconditionally — that's the point of it).
-- Plain `create table` does NOT enable RLS by default; leaving it off is
-- exactly the "table with no RLS" misconfiguration Supabase's own Advisors
-- tab flags, since it would otherwise leave both tables readable/writable by
-- anyone holding the project's anon key.
alter table geocode_cache enable row level security;
alter table itineraries enable row level security;
