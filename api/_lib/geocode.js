// Server-side geocoding via Mapbox Search Box. Never expose MAPBOX_TOKEN to
// the client — this module only runs inside Vercel Functions.
//
// Why Search Box (search/searchbox/v1/forward) instead of the legacy
// geocoding/v5/mapbox.places endpoint: live testing against real Antigua
// Guatemala landmarks found the legacy endpoint has no POI-level index entry
// for well-known named places at all — every query fell back to the city
// centroid, regardless of query wording. Search Box resolves the same
// landmarks correctly. The /forward endpoint bills per-request (not
// per-session) and does not require a session_token — that's only mandatory
// for the /suggest+/retrieve autocomplete flow, which we don't use.
import { haversineKm } from './geoMath.js'

// Module-level caches: survive for the lifetime of a warm function instance,
// reset on cold start. Fine for now — persistence is a later phase.
//
// Cache raw provider candidates (query -> normalized candidate), never the
// final accept/reject verdict — acceptance depends on the stop's proximity
// tier (in-city vs day-trip), and the same query text can legitimately be
// asked under either tier across different itineraries. Caching the verdict
// would let one itinerary's rejection wrongly poison another's acceptance.
const MAPBOX_QUERY_CACHE = new Map()
const CITY_CACHE = new Map()

const IN_CITY_DISTANCE_CEILING_KM = 25 // secondary net — primary gate for in-city stops is the context.place match
const DAY_TRIP_DISTANCE_CEILING_KM = 200 // primary gate for day-trip stops — covers volcano hikes, lake days, coastal excursions; still an order of magnitude tighter than the wrong-continent misses it needs to catch

const MAPBOX_CONCURRENCY_LIMIT = 5 // conservative enough to avoid bursting a per-second rate limit on a 20-30 stop itinerary; each queued call only waits ~100-200ms for a slot
const MAX_429_RETRIES = 3
const BACKOFF_BASE_MS = 300

// feature_type values that mean "matched an administrative area, not a
// specific place" — accepting these is how a landmark search silently becomes
// a generic city-center pin. Search Box has no relevance/confidence score on
// its features (unlike legacy v5), so this and context/distance validation
// below are the only safety nets.
const MAPBOX_BROAD_TYPES = new Set(['country', 'region', 'postcode', 'district', 'place', 'city', 'locality'])

// Names shared by literally every town in a region — "Parque Central" in
// Guatemala, "Old Town" anywhere — where the unqualified name is actively
// misleading rather than just imprecise. For these, city-qualified search is
// tried FIRST, not last.
const GENERIC_NAME_PATTERNS = [
  'parque central', 'plaza central', 'plaza principal', 'parque principal',
  'mercado central', 'central market', 'old town', 'town square', 'main street',
  'main square', 'city center', 'city centre', 'zocalo', 'zócalo', 'central plaza',
]

function normalizeKey(str) {
  return str.trim().toLowerCase().replace(/\s+/g, ' ')
}

function isGenericName(name) {
  const key = normalizeKey(name)
  return GENERIC_NAME_PATTERNS.some((pattern) => key.includes(pattern))
}

// The model's display name is written for a traveler, not a geocoder:
// "Catedral de Santiago (Santiago Cathedral)", "Café Sky (Rooftop Bar)" —
// parentheticals and trailing " - qualifier" clauses are exactly the kind of
// text a search engine treats as extra, unmatched tokens. Strip them for
// geocoding; the original stays untouched for display.
function normalizeSearchName(name) {
  return name
    .replace(/\([^)]*\)/g, '')
    .split(/\s[-–]\s/)[0]
    .replace(/\s+/g, ' ')
    .trim()
}

// Minimal semaphore — no external dependency needed for a cap this small.
function createLimiter(concurrency) {
  let active = 0
  const queue = []
  return async function limited(fn) {
    if (active >= concurrency) {
      await new Promise((resolve) => queue.push(resolve))
    }
    active++
    try {
      return await fn()
    } finally {
      active--
      const next = queue.shift()
      if (next) next()
    }
  }
}

const mapboxLimit = createLimiter(MAPBOX_CONCURRENCY_LIMIT)

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Wraps a fetch-returning thunk with exponential backoff on 429, distinct
// from a genuine empty result — rate-limiting is an operational problem, a
// miss is a data problem, and collapsing them in the logs hides which one is
// actually happening in production.
async function fetchWithBackoff(fn) {
  for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
    const res = await fn()
    if (res.status !== 429) return res
    if (attempt === MAX_429_RETRIES) return res
    const backoff = BACKOFF_BASE_MS * 2 ** attempt + Math.random() * 100
    await sleep(backoff)
  }
}

// ---------------------------------------------------------------------------
// Mapbox Search Box
// ---------------------------------------------------------------------------

async function mapboxForward(query, { proximity, types } = {}) {
  const token = process.env.MAPBOX_TOKEN
  if (!token) return { candidate: null, rateLimited: false }

  const cacheKey = normalizeKey(`${query}|${proximity ? `${proximity.lat},${proximity.lng}` : ''}|${types ?? ''}`)
  if (MAPBOX_QUERY_CACHE.has(cacheKey)) return MAPBOX_QUERY_CACHE.get(cacheKey)

  let url = `https://api.mapbox.com/search/searchbox/v1/forward?q=${encodeURIComponent(query)}&access_token=${token}&limit=1`
  if (proximity) url += `&proximity=${proximity.lng},${proximity.lat}`
  if (types) url += `&types=${types}`

  let result = { candidate: null, rateLimited: false }
  try {
    const res = await mapboxLimit(() => fetchWithBackoff(() => fetch(url)))
    if (res.status === 429) {
      console.error('mapbox search box rate-limited (exhausted retries)', query)
      result = { candidate: null, rateLimited: true }
    } else if (!res.ok) {
      console.error('mapbox search box non-OK response', query, res.status)
    } else {
      const data = await res.json()
      const feature = data.features?.[0]
      result = { candidate: normalizeMapboxFeature(feature), rateLimited: false }
    }
  } catch (err) {
    console.error('mapbox search box error', query, err)
  }

  MAPBOX_QUERY_CACHE.set(cacheKey, result)
  return result
}

function normalizeMapboxFeature(feature) {
  const coords = feature?.geometry?.coordinates
  if (!coords || coords.length !== 2) return null
  const p = feature.properties ?? {}
  return {
    lat: coords[1],
    lng: coords[0],
    isBroad: MAPBOX_BROAD_TYPES.has(p.feature_type),
    placeName: p.context?.place?.name ?? null,
    regionName: p.context?.region?.name ?? null,
    countryCode: p.context?.country?.country_code ?? null,
    provider: 'mapbox',
    providerId: p.mapbox_id ?? null,
    matchedName: p.name ?? null,
  }
}

// ---------------------------------------------------------------------------
// Shared context/distance validation
// ---------------------------------------------------------------------------

function evaluateCandidate(candidate, ctx) {
  if (!candidate) return { accept: false, reason: 'no result' }
  if (candidate.isBroad) return { accept: false, reason: 'fell back to an administrative-area match, not a specific place' }

  const cityMatches = candidate.placeName && ctx.targetCityName && normalizeKey(candidate.placeName) === normalizeKey(ctx.targetCityName)
  const regionMatches = candidate.regionName && ctx.targetRegionName && normalizeKey(candidate.regionName) === normalizeKey(ctx.targetRegionName)
  const countryMatches = candidate.countryCode && ctx.targetCountryCode && candidate.countryCode === ctx.targetCountryCode
  const distanceKm = ctx.cityCenter ? haversineKm(ctx.cityCenter, candidate) : null

  if (ctx.tier === 'day-trip') {
    // Context here can't require an exact place match by design — the whole
    // point of this tier is a stop that's genuinely NOT in the anchor city.
    // Country is the reliable signal (catches wrong-continent); distance is
    // the generous, primary gate.
    if (candidate.placeName && !cityMatches && !regionMatches && !countryMatches) {
      return { accept: false, reason: `wrong country (resolved in ${candidate.placeName}, country ${candidate.countryCode ?? 'unknown'})` }
    }
    if (distanceKm !== null && distanceKm > DAY_TRIP_DISTANCE_CEILING_KM) {
      return { accept: false, reason: `too far (${distanceKm.toFixed(1)}km > ${DAY_TRIP_DISTANCE_CEILING_KM}km day-trip ceiling)` }
    }
    return { accept: true, distanceKm }
  }

  // in-city tier: context.place match is the primary gate. A same-named
  // place whose context.place points at a different specific town — even a
  // few km away — is rejected outright, regardless of distance. This is the
  // fix for the Parque Central case: it landed only 7.5km outside Antigua,
  // close enough to pass any reasonable flat distance ceiling, but its
  // context.place was "Santa María de Jesús" — a different town's plaza.
  if (candidate.placeName) {
    if (!cityMatches) {
      return { accept: false, reason: `context mismatch — resolved in "${candidate.placeName}", not "${ctx.targetCityName}"` }
    }
    // Context matched; distance is now just a sanity check on top of that.
    if (distanceKm !== null && distanceKm > IN_CITY_DISTANCE_CEILING_KM) {
      return { accept: false, reason: `too far (${distanceKm.toFixed(1)}km > ${IN_CITY_DISTANCE_CEILING_KM}km in-city ceiling) despite matching context` }
    }
    return { accept: true, distanceKm }
  }

  // No context.place returned at all — fall back to distance-only, since
  // there's nothing to validate against.
  if (distanceKm !== null && distanceKm > IN_CITY_DISTANCE_CEILING_KM) {
    return { accept: false, reason: `too far (${distanceKm.toFixed(1)}km > ${IN_CITY_DISTANCE_CEILING_KM}km in-city ceiling), no context to validate against` }
  }
  return { accept: true, distanceKm }
}

// ---------------------------------------------------------------------------
// City anchor lookup
// ---------------------------------------------------------------------------

async function geocodeCity(city) {
  const key = normalizeKey(city)
  if (CITY_CACHE.has(key)) return CITY_CACHE.get(key)

  // A broad administrative match is exactly what we want here — this result
  // only ever serves as a proximity bias and as the anchor for context/
  // distance validation of stops in this city.
  const { candidate } = await mapboxForward(city, { types: 'place,locality,region,district,country' })
  const result = candidate ? { lat: candidate.lat, lng: candidate.lng, regionName: candidate.regionName, countryCode: candidate.countryCode } : null

  CITY_CACHE.set(key, result)
  return result
}

// ---------------------------------------------------------------------------
// Per-stop resolution: retry ladder x validation
// ---------------------------------------------------------------------------

function buildRungs(name, searchName, city, normalizedName) {
  const hasDistinctSearchName = searchName && normalizeKey(searchName) !== normalizeKey(name)
  const generic = isGenericName(name) || (searchName && isGenericName(searchName))

  const rungs = []
  if (generic) {
    // An unqualified generic name ("Parque Central") is actively misleading —
    // every town has one — so city-qualified search is tried first, not last.
    if (hasDistinctSearchName) rungs.push(['searchName+city', `${searchName}, ${city}`])
    rungs.push(['normalizedName+city', `${normalizedName}, ${city}`])
    if (hasDistinctSearchName) rungs.push(['searchName', searchName])
    rungs.push(['normalizedName', normalizedName])
  } else {
    if (hasDistinctSearchName) rungs.push(['searchName', searchName])
    rungs.push(['normalizedName', normalizedName])
    rungs.push(['name+city', `${name}, ${city}`])
  }
  return rungs
}

async function tryMapboxLadder(rungs, ctx) {
  const attempted = []
  let rateLimited = false
  for (const [rungName, query] of rungs) {
    attempted.push(`mapbox:${rungName}`)
    const { candidate, rateLimited: wasLimited } = await mapboxForward(query, { proximity: ctx.cityCenter })
    if (wasLimited) rateLimited = true
    if (!candidate) continue
    const verdict = evaluateCandidate(candidate, ctx)
    if (verdict.accept) return { winner: { candidate, provider: 'mapbox', wonBy: rungName }, attempted, rateLimited }
    console.log(`geocode rung rejected (${verdict.reason}): "${query}" [mapbox]`)
  }
  return { winner: null, attempted, rateLimited }
}

async function geocodeOne(stop, cityInfo) {
  const { name, city, searchName, proximity } = stop
  const tier = proximity === 'day-trip' ? 'day-trip' : 'in-city'
  const normalizedName = normalizeSearchName(name)
  const rungs = buildRungs(name, searchName, city, normalizedName)

  const ctx = {
    targetCityName: city,
    targetRegionName: cityInfo?.regionName ?? null,
    targetCountryCode: cityInfo?.countryCode ?? null,
    cityCenter: cityInfo ? { lat: cityInfo.lat, lng: cityInfo.lng } : null,
    tier,
  }

  const { winner, attempted, rateLimited } = await tryMapboxLadder(rungs, ctx)

  if (winner) {
    console.log(`geocode resolved "${name}, ${city}" via ${winner.provider}:${winner.wonBy} (attempted: ${attempted.join(', ')})`)
  } else {
    console.log(`geocode exhausted all rungs for "${name}, ${city}" (attempted: ${attempted.join(', ')}${rateLimited ? ', RATE-LIMITED' : ''})`)
  }

  return { winner, attempted, rateLimited: rateLimited && !winner }
}

// Geocodes every stop in parallel. Returns a new array of stops with lat/lng
// attached, or unlocatable: true (never fake coordinates, never drop the
// stop). Silent degradation of this pipeline is the worst failure mode this
// product has — geocoding failing quietly means the core map-aware feature
// (clustering, ordering, travel times) turns itself off with no visible
// signal — so a >20% per-itinerary failure rate logs loudly, by name, with
// exactly which rungs were tried and whether the failure was a genuine miss
// or rate-limiting, rather than only showing up as a support screenshot.
export async function geocodeStops(stops) {
  // Phase 1: geocode each distinct city once (cached), used as a proximity
  // bias and as the context/distance validation anchor.
  const uniqueCities = [...new Set(stops.map((s) => normalizeKey(s.city)))]
  const cityResults = await Promise.all(uniqueCities.map((c) => geocodeCity(c)))
  const cityInfoByCity = new Map(uniqueCities.map((c, i) => [c, cityResults[i]]))

  // Phase 2: geocode every stop in parallel; each stop's own ladder runs
  // sequentially (rung by rung) internally, but stops don't wait on each
  // other. The concurrency limiter caps the actual number of in-flight
  // requests across all stops at once.
  const results = await Promise.all(stops.map((s) => geocodeOne(s, cityInfoByCity.get(normalizeKey(s.city)))))

  const failures = []
  const enriched = stops.map((s, i) => {
    const { winner, attempted, rateLimited } = results[i]
    if (winner) {
      return { ...s, lat: winner.candidate.lat, lng: winner.candidate.lng, unlocatable: false, resolvedVia: `${winner.provider}:${winner.wonBy}` }
    }
    const reason = rateLimited ? 'rate-limited' : 'no-match'
    failures.push({ name: s.name, city: s.city, attempted, reason })
    return { ...s, lat: null, lng: null, unlocatable: true, unlocatableReason: reason }
  })

  if (stops.length > 0 && failures.length / stops.length > 0.2) {
    const rateLimitedCount = failures.filter((f) => f.reason === 'rate-limited').length
    console.warn(
      `GEOCODE DEGRADATION: ${failures.length}/${stops.length} stops (${Math.round(
        (failures.length / stops.length) * 100,
      )}%) failed to resolve in this itinerary (${rateLimitedCount} rate-limited, ${failures.length - rateLimitedCount} genuine no-match):`,
      failures.map((f) => `"${f.name}, ${f.city}" [${f.reason}] (tried: ${f.attempted.join(' -> ') || 'none'})`),
    )
  }

  return enriched
}
