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
// placeKey is now also traveler-facing (Phase 2, overnight build): the
// Bucket List tab matches a saved place against an itinerary stop by this
// exact same identity key (see src/services/quickSaves.js and StopCard's
// isOnBucketList prop), so it has to survive into the API response and the
// saved payload, not just this function's own internal clip lookup. It's a
// plain normalized string ("eiffel tower|paris|fr") — nothing sensitive.
export async function attachCreatorClips(days) {
  const supabase = getSupabase()
  if (!supabase) return days

  const keys = new Set()
  days.forEach((day) => day.stops.forEach((stop) => stop.placeKey && keys.add(stop.placeKey)))
  if (keys.size === 0) return days

  let clipsByKey = new Map()
  try {
    const { data, error } = await supabase.from('creator_clips').select('cache_key, video_url, caption').in('cache_key', [...keys])
    if (error) throw error
    clipsByKey = new Map(data.map((row) => [row.cache_key, { videoUrl: row.video_url, caption: row.caption }]))
  } catch (err) {
    console.error('creator_clips lookup failed, serving itinerary without clips:', err)
    return days
  }

  if (clipsByKey.size === 0) return days

  return days.map((day) => ({
    ...day,
    stops: day.stops.map((stop) => {
      const clip = stop.placeKey ? clipsByKey.get(stop.placeKey) : null
      return clip ? { ...stop, creatorClip: clip } : stop
    }),
  }))
}
