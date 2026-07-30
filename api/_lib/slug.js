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

export function normalizeQuery(query) {
  return query.trim().toLowerCase().replace(/\s+/g, ' ')
}
