// The anonymous-browsing trip history — always localStorage-only, so a
// signed-out visitor's recent searches work with no account at all. Every
// read/write is wrapped so a user with localStorage blocked or full
// (private browsing, quota) just never sees the strip, rather than
// crashing. On sign-in, AuthContext.jsx's migrateLocalDataToAccount claims
// these slugs onto the new account (see accountMigration.js) and clears
// this list — see clearRecentTrips below.
const KEY = 'uatw:recentTrips'
const MAX = 8

function readAll() {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function writeAll(trips) {
  try {
    localStorage.setItem(KEY, JSON.stringify(trips))
  } catch {
    // localStorage unavailable — degrade silently, no history persists this session
  }
}

export function getRecentTrips() {
  return readAll()
}

export function addRecentTrip({ slug, destination, query }) {
  if (!slug) return
  const trips = readAll().filter((t) => t.slug !== slug)
  trips.unshift({ slug, destination: destination || query, query, addedAt: new Date().toISOString() })
  writeAll(trips.slice(0, MAX))
}

export function removeRecentTrip(slug) {
  writeAll(readAll().filter((t) => t.slug !== slug))
}

export function clearRecentTrips() {
  writeAll([])
}
