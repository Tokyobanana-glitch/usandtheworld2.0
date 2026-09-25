// Client-only tracking for the Travel tab's Watching and Shared-with-me
// segments (see TripsPage.jsx). Both are this-device-only, same tradeoff
// recentTrips.js already makes for anonymous "Planned":
//
// - trip_watch (supabase/schema.sql) is keyed by slug+email, not by account —
//   the email typed into TripPage.jsx's watch form need not match the
//   signer-in user's own account email at all, so there's no reliable
//   server-side "trips I'm watching" query to run for a signed-in user.
// - Shared-with-me has no table at all. TripPage.jsx decides whether a trip
//   "isn't theirs" with a read through the RLS-scoped itineraries policy
//   (see supabase/005_itinerary_owner_select.sql) — a row comes back only
//   when `owner = auth.uid()`, so a query that returns nothing for a
//   signed-in viewer already means "not mine" with no extra column needed.
//   That's a read, not a write, so recording still only ever happens here.
const WATCHING_KEY = 'uatw:watchingTrips'
const SHARED_KEY = 'uatw:sharedTrips'
const MAX = 24

function readAll(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function writeAll(key, trips) {
  try {
    localStorage.setItem(key, JSON.stringify(trips))
  } catch {
    // localStorage unavailable — degrade silently, same as recentTrips.js
  }
}

function addTrip(key, { slug, destination, dayCount, verifiedAt }) {
  if (!slug) return
  const trips = readAll(key).filter((t) => t.slug !== slug)
  trips.unshift({
    slug,
    destination: destination || slug,
    dayCount: dayCount ?? null,
    verifiedAt: verifiedAt ?? null,
    addedAt: new Date().toISOString(),
  })
  writeAll(key, trips.slice(0, MAX))
}

export function getWatchingTrips() {
  return readAll(WATCHING_KEY)
}

export function addWatchingTrip(trip) {
  addTrip(WATCHING_KEY, trip)
}

export function removeWatchingTrip(slug) {
  writeAll(WATCHING_KEY, readAll(WATCHING_KEY).filter((t) => t.slug !== slug))
}

export function getSharedTrips() {
  return readAll(SHARED_KEY)
}

export function addSharedTrip(trip) {
  addTrip(SHARED_KEY, trip)
}

export function removeSharedTrip(slug) {
  writeAll(SHARED_KEY, readAll(SHARED_KEY).filter((t) => t.slug !== slug))
}
