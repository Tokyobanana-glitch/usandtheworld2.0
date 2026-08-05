import { randomBytes } from 'crypto'

// Unambiguous charset (no 0/O, 1/l/I) — these end up in URLs people read aloud
// or retype from a screenshot.
const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyzACDEFGHJKMNPQRSTUVWXYZ'

export function generateSlug(length = 8) {
  const bytes = randomBytes(length)
  let slug = ''
  for (let i = 0; i < length; i++) {
    slug += ALPHABET[bytes[i] % ALPHABET.length]
  }
  return slug
}

// Deliberately NOT general fuzzy matching — itineraryStore.js already
// reasoned through that tradeoff and rejected it (a near-miss served as a
// cache hit is worse than a redundant regeneration). This only folds a
// short, explicit list of verb-wrapper prefixes that carry zero
// trip-defining information on their own ("trip to", "i want to visit") so
// "Trip to Kyoto" and "Kyoto" hit the same cache row. It never touches
// duration, dates, or qualifiers — those change what's actually being asked
// and must keep producing distinct cache entries.
const LEADING_FILLER = [
  /^i want to (go to|travel to|visit)\s+/,
  /^i'?d like to (go|travel) to\s+/,
  /^travel(ing)? to\s+/,
  /^trip to\s+/,
  /^vacation (to|in)\s+/,
  /^visit(ing)?\s+/,
  /^weekend\s+(trip\s+)?(to|in|at)\s+/,
]

export function normalizeQuery(query) {
  let q = query.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[?!.]+$/, '')
  for (const re of LEADING_FILLER) {
    if (re.test(q)) {
      q = q.replace(re, '')
      break
    }
  }
  return q.trim()
}
