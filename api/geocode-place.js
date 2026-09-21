import { geocodeStops } from './_lib/geocode.js'

// Small wrapper around the shared geocoding pipeline for the Bucket List's
// "add a place" search — same pipeline and place identity (placeKey, from
// geocodeCacheKey) an itinerary stop resolves to, so a bucket-list place and
// a trip stop for the same real place always share a key. Public: geocoding
// a place name isn't sensitive, and the endpoint does no DB writes itself.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const { name, city } = req.body ?? {}
  if (!name || typeof name !== 'string' || !name.trim() || !city || typeof city !== 'string' || !city.trim()) {
    res.status(400).json({ error: "Both 'name' and 'city' are required" })
    return
  }

  try {
    const [result] = await geocodeStops([
      { name: name.trim(), searchName: name.trim(), city: city.trim(), locality: city.trim(), proximity: 'in-city' },
    ])

    res.status(200).json({
      name: result.name,
      city: result.city,
      lat: result.unlocatable ? null : result.lat,
      lng: result.unlocatable ? null : result.lng,
      unlocatable: !!result.unlocatable,
      placeKey: result.placeKey,
    })
  } catch (err) {
    console.error('geocode-place error:', err)
    res.status(502).json({ error: 'Failed to resolve this place' })
  }
}
