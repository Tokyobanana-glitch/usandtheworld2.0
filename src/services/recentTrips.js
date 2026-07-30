// No accounts in this phase — trip history lives in localStorage only.
// Every read/write is wrapped so a user with localStorage blocked or full
// (private browsing, quota) just never sees the strip, rather than crashing.
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
