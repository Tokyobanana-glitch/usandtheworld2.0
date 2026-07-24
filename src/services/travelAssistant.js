const CACHE = new Map()
const TTL_MS = 5 * 60 * 1000

export async function askTravelAssistant(query, { bypassCache = false } = {}) {
  const key = query.trim().toLowerCase()

  if (!bypassCache) {
    const cached = CACHE.get(key)
    if (cached && Date.now() < cached.expiresAt) return cached.result
  }

  const res = await fetch('/api/travel-assistant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `Travel assistant error ${res.status}`)
  }

  const result = await res.json()
  CACHE.set(key, { result, expiresAt: Date.now() + TTL_MS })
  return result
}
