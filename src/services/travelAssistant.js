import { getSupabaseClient } from './supabaseClient'

const CACHE = new Map()
const TTL_MS = 5 * 60 * 1000

export async function askTravelAssistant(query, { bypassCache = false, history = [] } = {}) {
  const key = query.trim().toLowerCase()
  const cacheable = !bypassCache && history.length === 0

  if (cacheable) {
    const cached = CACHE.get(key)
    if (cached && Date.now() < cached.expiresAt) return cached.result
  }

  // Attaching the access token when signed in is what lets the server
  // attribute this generation's saved itinerary to the account (see
  // api/travel-assistant.js) — search/generation itself never requires it;
  // a signed-out visitor (no client, or no session) just sends none.
  const headers = { 'Content-Type': 'application/json' }
  const session = (await getSupabaseClient()?.auth.getSession())?.data?.session
  if (session) headers.Authorization = `Bearer ${session.access_token}`

  const res = await fetch('/api/travel-assistant', {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, history }),
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `Travel assistant error ${res.status}`)
  }

  const result = await res.json()
  if (cacheable) CACHE.set(key, { result, expiresAt: Date.now() + TTL_MS })
  return result
}
