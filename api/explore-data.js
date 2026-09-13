import { listExploreTrips } from './_lib/itineraryStore.js'

// JSON counterpart to api/explore-page.js — that endpoint serves a full SSR
// HTML page (for direct loads/crawlers/OG tags) and must keep doing exactly
// that unchanged. This one exists purely for client-side fetches: the
// Explore tab when reached via in-app navigation (no injected
// window.__EXPLORE_DATA__ to hydrate from) and the Discover landing's
// verified-trips feed. Same underlying data, no HTML.
export default async function handler(req, res) {
  try {
    const trips = await listExploreTrips()
    res.status(200).json({ trips })
  } catch (err) {
    console.error('explore-data error:', err)
    res.status(502).json({ error: 'Failed to load explore trips' })
  }
}
