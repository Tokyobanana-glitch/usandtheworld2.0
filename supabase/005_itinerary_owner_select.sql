-- Run this in the Supabase SQL Editor after 004_auth_bucket_passport.sql.
--
-- schema.sql enabled RLS on itineraries with zero policies on purpose —
-- deny-all for anon/authenticated, since only the server (service_role,
-- which bypasses RLS) ever touched this table before accounts existed. Now
-- that itineraries.owner is actually populated (see api/travel-assistant.js
-- setting it at generation time for a signed-in request, and
-- api/claim-trips.js retroactively claiming a device's local trips on
-- sign-in), the Travel tab needs to read a signed-in user's own trips
-- directly through the browser client — the same RLS-scoped-read pattern
-- bucket_lists/passport_entries already use.
--
-- Read-only: this adds a SELECT policy only. Every write to itineraries
-- still goes exclusively through server endpoints using service_role — no
-- insert/update/delete policy is added here, on purpose.
drop policy if exists "itineraries select own" on itineraries;
create policy "itineraries select own" on itineraries for select using (owner = auth.uid());
