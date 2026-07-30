import { generateAnswer } from './_lib/generateAnswer.js'
import { findCachedItinerary, saveItinerary } from './_lib/itineraryStore.js'

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

  try {
    const parsed = await generateAnswer(query, history)

    if (parsed.itinerary?.length > 0) {
      // A plan worth sharing gets a standalone page — mint a slug whenever
      // there's an itinerary, follow-up or not, since /trip/[slug] renders it
      // on its own regardless of how the conversation that produced it went.
      try {
        const slug = await saveItinerary({ query, payload: parsed })
        if (slug) parsed.slug = slug
      } catch (saveErr) {
        console.error('itinerary save failed, serving without a share link:', saveErr)
      }
    }

    res.status(200).json(parsed)
  } catch (err) {
    console.error('travel-assistant error:', err)
    res.status(502).json({ error: 'Failed to generate travel answer' })
  }
}
