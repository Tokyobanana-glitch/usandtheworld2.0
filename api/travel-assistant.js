import { generateAnswer } from './_lib/generateAnswer.js'
import { findCachedItinerary, saveItinerary } from './_lib/itineraryStore.js'
import { getUserFromRequest } from './_lib/supabaseAuth.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const { query, history } = req.body ?? {}
  if (!query || typeof query !== 'string') {
    res.status(400).json({ error: "Missing 'query' string in request body" })
    return
  }

  // Cache matching only applies to a fresh, no-history query — a follow-up's
  // meaning depends on the prior turns, and matching on query text alone
  // there would be exactly the near-miss-as-hit risk this is designed to
  // avoid. Exact normalized-string match only, within the freshness window;
  // see itineraryStore.js for why that's the right tradeoff.
  const hasHistory = Array.isArray(history) && history.length > 0
  if (!hasHistory) {
    try {
      const cached = await findCachedItinerary(query)
      if (cached) {
        res.status(200).json({ ...cached.payload, slug: cached.slug })
        return
      }
    } catch (cacheErr) {
      console.error('itinerary cache lookup failed, falling through to fresh generation:', cacheErr)
    }
  }

  // Optional and never blocking: a missing/invalid/expired token just means
  // an anonymous save, exactly like today — search and generation above
  // this point never even look at auth state. See supabaseAuth.js.
  const user = await getUserFromRequest(req)

  try {
    const parsed = await generateAnswer(query, history)

    if (parsed.itinerary?.length > 0) {
      // A plan worth sharing gets a standalone page — mint a slug whenever
      // there's an itinerary, follow-up or not, since /trip/[slug] renders it
      // on its own regardless of how the conversation that produced it went.
      try {
        const slug = await saveItinerary({ query, payload: parsed, owner: user?.id ?? null })
        if (slug) parsed.slug = slug
      } catch (saveErr) {
        console.error('itinerary save failed, serving without a share link:', saveErr)
      }
    }

    res.status(200).json(parsed)
  } catch (err) {
    console.error('travel-assistant error:', err)
    // Surface the specific message when generateAnswer threw one on purpose
    // (e.g. the itinerary hitting the max_tokens ceiling) — the client
    // already renders whatever string lands here as the turn's error text,
    // so a generic fallback here was silently swallowing a message that
    // actually told the traveler what to do differently.
    res.status(502).json({ error: err.message || 'Failed to generate travel answer' })
  }
}
