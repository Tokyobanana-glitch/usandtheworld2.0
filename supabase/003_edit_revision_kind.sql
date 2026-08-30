-- Run this in the Supabase SQL Editor after 002_growth_features.sql is
-- already applied.
--
-- itineraries.source_slug already marks a row as a fork of an earlier one
-- (used by both the re-verify path and, now, the edit path). This column
-- says WHICH KIND of fork it is, so the original trip page can tell a
-- viewer "an edited version exists" apart from "a re-verified version
-- exists" instead of collapsing both into one generic link. Null for every
-- original row (source_slug is also null there); 'reverify' or 'edit' for a
-- child row. See api/_lib/itineraryStore.js, api/trip-reverify.js, and
-- api/trip-edit.js.
alter table itineraries add column if not exists revision_kind text;

-- Postgres has no ADD CONSTRAINT IF NOT EXISTS — guard with a catalog check
-- instead so this migration stays safe to re-run.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'itineraries_revision_kind_check'
  ) then
    alter table itineraries
      add constraint itineraries_revision_kind_check
      check (revision_kind is null or revision_kind in ('reverify', 'edit'));
  end if;
end $$;

create index if not exists itineraries_revision_kind_idx on itineraries (revision_kind);
