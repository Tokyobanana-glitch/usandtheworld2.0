import { getSupabase } from './supabase.js'

// Attaches personally-shot content to itinerary stops. Keyed on the exact
// same `placeKey` the geocoder resolves each stop to (geocodeCacheKey in
// geocode.js) — NOT on display name, which the model rephrases between
// regenerations ("Tenryu-ji" vs "Tenryu-ji Temple"). Reusing the geocoder's
// own identity key means a clip tagged once matches every future itinerary
// that includes that place, regardless of how the model phrases it that time.
//
// Missing/failed lookups degrade silently to "no clip" — this is enrichment,
// never something that should be able to break itinerary generation.
export async function attachCreatorClips(days) {
  const supabase = getSupabase()
  if (!supabase) return stripPlaceKeys(days)

  const keys = new Set()
  days.forEach((day) => day.stops.forEach((stop) => stop.placeKey && keys.add(stop.placeKey)))
  if (keys.size === 0) return stripPlaceKeys(days)

  let clipsByKey = new Map()
  try {
    const { data, error } = await supabase.from('creator_clips').select('cache_key, video_url, caption').in('cache_key', [...keys])
    if (error) throw error
    clipsByKey = new Map(data.map((row) => [row.cache_key, { videoUrl: row.video_url, caption: row.caption }]))
  } catch (err) {
    console.error('creator_clips lookup failed, serving itinerary without clips:', err)
    return stripPlaceKeys(days)
  }

  if (clipsByKey.size === 0) return stripPlaceKeys(days)

  return days.map((day) => ({
    ...day,
    stops: day.stops.map((stop) => {
      const clip = stop.placeKey ? clipsByKey.get(stop.placeKey) : null
      const { placeKey: _placeKey, ...rest } = stop
      return clip ? { ...rest, creatorClip: clip } : rest
    }),
  }))
}

// placeKey is an internal identity key, not traveler-facing data — strip it
// before the itinerary ever reaches an API response even when there's no
// Supabase configured or no clips matched.
function stripPlaceKeys(days) {
  return days.map((day) => ({
    ...day,
    stops: day.stops.map(({ placeKey: _placeKey, ...rest }) => rest),
  }))
}
