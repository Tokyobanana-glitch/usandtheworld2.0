// Remembers the traveler's last-used intake answers so the panel prefills
// next time — same localStorage pattern as recentTrips.js: no accounts, and
// every read/write is wrapped so a user with localStorage blocked or full
// just gets a blank panel next time rather than a crash.
//
// Deliberately does NOT include "days" — that's trip-specific (a weekend
// trip and a two-week trip don't share a default), not a traveler
// preference, and destination/topic obviously never belongs here either.
const KEY = 'uatw:intakePrefs'

function readPrefs() {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function getIntakePreferences() {
  return readPrefs()
}

export function saveIntakePreferences(prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // localStorage unavailable — degrade silently, preferences just won't persist
  }
}

export function clearIntakePreferences() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}
