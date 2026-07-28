// Server-side geocoding via Mapbox. Never expose MAPBOX_TOKEN to the client —
// this module only runs inside Vercel Functions.
import { haversineKm } from './geoMath.js'

// Module-level caches: survive for the lifetime of a warm function instance,
// reset on cold start. Fine for now — persistence is a later phase.
const STOP_CACHE = new Map() // normalized "name, city" -> { lat, lng } | null
const CITY_CACHE = new Map() // normalized city -> { lat, lng } | null

// A bare "name, city" query has no geographic context, so Mapbox's text
// matcher can (and in testing, did) match a landmark name to a same-named or
// textually-similar place on a completely different continent — "Tenryu-ji
// Temple, Kyoto" came back in Indonesia, "Arashiyama Bamboo Grove" in Toronto.
// A hard bbox constraint sounds like the fix, but empirically made things
// *worse* for well-covered landmarks (Mapbox falls back to a generic
// low-relevance neighborhood match rather than returning nothing) — Kiyomizu-
// dera went from a correct 0.685-relevance match to a wrong 0.43 fallback once
// boxed in. So: use `proximity` only as a soft bias, then apply two
// independent safety nets after the fact — relevance floor (catches "gave up
// and matched the city center") and distance-from-city ceiling (catches
// "confidently matched the wrong country", which relevance alone missed: the
// Indonesia mismatch scored 0.558, in the same range as legitimate matches).
const MIN_RELEVANCE = 0.5
const MAX_STOP_DISTANCE_FROM_CITY_KM = 100 // generous enough for day-trip-adjacent places
// Feature types that mean "matched an administrative area, not a specific
// place" — accepting these is how a landmark search silently becomes a
// generic city-center pin.
const BROAD_TYPES = new Set(['place', 'region', 'country', 'district', 'postcode'])

function normalizeKey(str) {
  return str.trim().toLowerCase().replace(/\s+/g, ' ')
}

async function geocodeCity(city) {
  const key = normalizeKey(city)
  if (CITY_CACHE.has(key)) return CITY_CACHE.get(key)

  const token = process.env.MAPBOX_TOKEN
  if (!token) {
    CITY_CACHE.set(key, null)
    return null
  }

  const query = encodeURIComponent(city)
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json?access_token=${token}&limit=1&types=place,locality,region`

  let result = null
  try {
    const res = await fetch(url)
    if (res.ok) {
      const data = await res.json()
      const feature = data.features?.[0]
      if (feature?.center?.length === 2) {
        const [lng, lat] = feature.center
        result = { lat, lng }
      }
    } else {
      console.error('mapbox city geocode non-OK response', city, res.status)
    }
  } catch (err) {
    console.error('mapbox city geocode error', city, err)
  }

  CITY_CACHE.set(key, result)
  return result
}

async function geocodeOne(name, city, cityCenter) {
  const key = normalizeKey(`${name}, ${city}`)
  if (STOP_CACHE.has(key)) return STOP_CACHE.get(key)

  const token = process.env.MAPBOX_TOKEN
  if (!token) {
    STOP_CACHE.set(key, null)
    return null
  }

  const query = encodeURIComponent(`${name}, ${city}`)
  let url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json?access_token=${token}&limit=1`
  if (cityCenter) url += `&proximity=${cityCenter.lng},${cityCenter.lat}`

  let result = null
  try {
    const res = await fetch(url)
    if (res.ok) {
      const data = await res.json()
      const feature = data.features?.[0]
      // Relevance is a red herring here: a query for "Kyoto Imperial Palace"
      // that Mapbox can't find will confidently (relevance 1.0!) match plain
      // "Kyoto" the city instead — relevance measures how well the matched
      // text fits, not whether the landmark itself was found. place_type is
      // the reliable signal: BROAD_TYPES are administrative-area fallbacks in
      // disguise, never a specific place, regardless of relevance score.
      const isBroadFallback = feature?.place_type?.some((t) => BROAD_TYPES.has(t))
      if (feature?.center?.length === 2 && !isBroadFallback && (feature.relevance ?? 1) >= MIN_RELEVANCE) {
        const [lng, lat] = feature.center
        const candidate = { lat, lng }
        if (!cityCenter || haversineKm(cityCenter, candidate) <= MAX_STOP_DISTANCE_FROM_CITY_KM) {
          result = candidate
        } else {
          console.log(`geocode rejected (too far from ${city}): "${name}" matched ${lat},${lng}`)
        }
      } else if (feature && isBroadFallback) {
        console.log(`geocode rejected (fell back to ${feature.place_type.join(',')}-level match): "${name}, ${city}"`)
      } else if (feature) {
        console.log(`geocode rejected (low relevance ${feature.relevance}): "${name}, ${city}"`)
      }
    } else {
      console.error('mapbox geocode non-OK response', name, city, res.status)
    }
  } catch (err) {
    console.error('mapbox geocode error', name, city, err)
  }

  STOP_CACHE.set(key, result)
  return result
}

// Geocodes every stop in parallel. Returns a new array of stops with lat/lng
// attached, or unlocatable: true (never fake coordinates, never drop the stop).
export async function geocodeStops(stops) {
  // Phase 1: geocode each distinct city once (cached), used only as a soft
  // proximity bias and as the anchor for the distance sanity check.
  const uniqueCities = [...new Set(stops.map((s) => normalizeKey(s.city)))]
  const cityResults = await Promise.all(uniqueCities.map((c) => geocodeCity(c)))
  const cityCenters = new Map(uniqueCities.map((c, i) => [c, cityResults[i]]))

  // Phase 2: geocode every stop in parallel.
  const results = await Promise.all(
    stops.map((s) => geocodeOne(s.name, s.city, cityCenters.get(normalizeKey(s.city)))),
  )

  return stops.map((s, i) => {
    const geo = results[i]
    if (geo) return { ...s, lat: geo.lat, lng: geo.lng, unlocatable: false }
    return { ...s, lat: null, lng: null, unlocatable: true }
  })
}
