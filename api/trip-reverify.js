import { generateAnswer } from './_lib/generateAnswer.js'
import { getItineraryBySlug, saveItinerary } from './_lib/itineraryStore.js'
import { diffItineraries } from './_lib/itineraryDiff.js'

// Re-verifying always mints a NEW slug rather than updating the existing row
// — the original shared link must keep showing exactly what was shared, or
// a link sent on day 1 could silently show a different plan on day 20. The
// original page links forward to this new version instead (see
// findNewerVersion in itineraryStore.js).
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const { slug } = req.body ?? {}
  if (!slug || typeof slug !== 'string') {
    res.status(400).json({ error: "Missing 'slug' string in request body" })
    return
  }

  try {
    const result = await getItineraryBySlug(slug)
    if (result.status === 'not-found') {
      res.status(404).json({ error: 'Trip not found' })
      return
    }
    if (result.status === 'error') {
      res.status(503).json({ error: 'Trip data is temporarily unavailable — please try again in a moment' })
      return
    }
    const existing = result.trip

    const fresh = await generateAnswer(existing.query, [], { reverifyItinerary: existing.payload.itinerary })
    const diff = diffItineraries(existing.payload, fresh)

    const newSlug = await saveItinerary({ query: existing.query, payload: fresh, sourceSlug: slug })
    if (!newSlug) {
      res.status(502).json({ error: 'Failed to save re-verified trip' })
      return
    }
    fresh.slug = newSlug

    res.status(200).json({ newSlug, diff, payload: fresh })
  } catch (err) {
    console.error('trip-reverify error:', err)
    res.status(502).json({ error: 'Failed to re-verify trip' })
  }
}
