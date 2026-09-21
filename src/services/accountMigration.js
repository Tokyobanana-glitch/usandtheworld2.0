import { getRecentTrips, clearRecentTrips } from './recentTrips'

// Runs once right after a fresh sign-in (see AuthContext.jsx's
// onAuthStateChange SIGNED_IN handler, not the initial session restore) —
// claims this browser's anonymous recentTrips onto the new account, then
// clears them. Idempotent two ways over: clearing on success means a repeat
// sign-in on the same device finds nothing left to migrate, and the server
// endpoint only ever claims a slug whose itineraries.owner is still null
// (see api/claim-trips.js), so even a genuinely repeated call — a second
// device, a race, a retry — can never steal a trip that's already been
// claimed or reassign one that's already someone else's.
export async function migrateLocalDataToAccount(session) {
  const trips = getRecentTrips()
  if (trips.length === 0) return

  const slugs = trips.map((t) => t.slug).filter(Boolean)
  if (slugs.length === 0) return

  const res = await fetch('/api/claim-trips', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ slugs }),
  })

  if (!res.ok) {
    // Leave localStorage as-is on failure — a network blip or an expired
    // token shouldn't silently lose the traveler's local trip history; the
    // next sign-in (or a later retry) gets another chance to claim them.
    console.error('claim-trips failed:', await res.text().catch(() => res.statusText))
    return
  }

  clearRecentTrips()
}
