// Server-side geocoding: Mapbox Search Box (primary) -> Wikidata (free
// fallback, tier 1) -> Geoapify/OpenStreetMap (free fallback, tier 2). Never
// expose MAPBOX_TOKEN or GEOAPIFY_API_KEY to the client — this module only
// runs inside Vercel Functions. Wikidata needs no key at all.
//
// Why Search Box (search/searchbox/v1/forward) instead of the legacy
// geocoding/v5/mapbox.places endpoint: live testing against real Antigua
// Guatemala landmarks found the legacy endpoint has no POI-level index entry
// for well-known named places at all. Search Box resolves the same landmarks
// correctly. The /forward endpoint bills per-request and needs no
// session_token (that's only for the /suggest+/retrieve autocomplete flow).
//
// Why free fallbacks instead of a paid one: a 30-place regression fixture
// found Mapbox misses a specific, non-random category — Hagia Sophia, the
// Blue Mosque, Piazza Navona, Kinkaku-ji, Arashiyama, Tenryu-ji — extremely
// documented places that aren't *businesses*, which is what commercial POI
// geocoders are built to index. Wikidata indexes exactly this category, with
// precise coordinates and strong multilingual labels, and needs no key.
// Geoapify's OSM-backed geocoder is the second-tier catch-all for the
// smaller venues (restaurants, markets) Wikidata won't have — free, no card,
// 3000 requests/day, and being a keyed provider with its own quota means we
// aren't drawing on the community-good-faith public Nominatim/Photon
// instances (both capped at ~1req/s with ban risk for exceeding it).
import { haversineKm } from './geoMath.js'

// Module-level caches: survive for the lifetime of a warm function instance,
// reset on cold start. Fine for now — persistence is a later phase.
//
// Cache raw provider candidates (query -> normalized candidate), never the
// final accept/reject verdict — acceptance depends on the stop's proximity
// tier and locality, and the same query text can legitimately be asked under
// different anchors across different itineraries. Caching the verdict would
// let one itinerary's rejection wrongly poison another's acceptance.
const MAPBOX_QUERY_CACHE = new Map()
const WIKIDATA_QUERY_CACHE = new Map()
const GEOAPIFY_QUERY_CACHE = new Map()
const CITY_CACHE = new Map()

const IN_CITY_DISTANCE_CEILING_KM = 25 // secondary net — primary gate for in-city (and locality-anchored day-trip) stops is the context.place match
const DAY_TRIP_DISTANCE_CEILING_KM = 200 // primary gate only when a stop has no locality to anchor against; also the sanity ceiling on how far a claimed locality may be from the trip's base city

const MAPBOX_CONCURRENCY_LIMIT = 5 // conservative enough to avoid bursting a per-second rate limit on a 20-30 stop itinerary; each queued call only waits ~100-200ms for a slot
const WIKIDATA_CONCURRENCY_LIMIT = 2 // live testing tripped Wikidata's edge rate limiter (HTTP 429, x-envoy-ratelimited, retry-after: 6) under bursty testing; fetchWithBackoff now honors that Retry-After header explicitly rather than guessing, which is the real fix — full serialization (1) was tried too and made worst-case latency far worse (53s vs ~10s) without eliminating 429s entirely, since a single itinerary can still legitimately fire many sequential Wikidata calls
const GEOAPIFY_CONCURRENCY_LIMIT = 5 // keyed, quota-based — same headroom as Mapbox
const MAX_429_RETRIES = 3
const BACKOFF_BASE_MS = 300
const WIKIDATA_MAX_ATTEMPTS_PER_ITINERARY = 8 // hard cap regardless of concurrency — bounds worst-case latency/rate-limit exposure when many stops in one itinerary route to Wikidata at once (observed 30-60s+ without this cap during testing)

const WIKIMEDIA_USER_AGENT = 'UsAndTheWorld/1.0 (travel itinerary geocoding fallback; contact via project repo)'

// feature_type values that mean "matched an administrative area, not a
// specific place" — accepting these is how a landmark search silently becomes
// a generic city-center pin. Search Box has no relevance/confidence score on
// its features (unlike legacy v5), so this and context/distance validation
// below are the only safety nets.
const MAPBOX_BROAD_TYPES = new Set(['country', 'region', 'postcode', 'district', 'place', 'city', 'locality'])

// Geoapify's result_type values that mean the same thing.
const GEOAPIFY_BROAD_TYPES = new Set(['suburb', 'district', 'postcode', 'city', 'county', 'state', 'country'])

// Wikidata "instance of" (P31) values that mean the search matched something
// that is definitely not a physical place — a novel, a film, a person sharing
// the name. Not exhaustive; a blacklist here is safer than an allowlist,
// since physical-place subclasses are too numerous to enumerate completely,
// but these are the traps this project has actually hit (a novel titled
// after a temple ranked ahead of the temple itself in one test search).
const WIKIDATA_REJECT_INSTANCE_OF = new Set([
  'Q5', // human
  'Q11424', // film
  'Q7889', // video game
  'Q571', // book
  'Q7725634', // literary work
  'Q5398426', // television series
  'Q482994', // album
])

// Pragmatic subset for comparing a Wikidata entity's P17 (country) against
// our target country — covers common travel destinations. Missing an entry
// isn't a correctness bug: the country check is skipped and validation falls
// back to the locality/distance checks, same as any other provider when
// context is incomplete.
const WIKIDATA_COUNTRY_QID_TO_ISO2 = {
  Q17: 'JP', Q30: 'US', Q142: 'FR', Q183: 'DE', Q38: 'IT', Q29: 'ES', Q45: 'PT',
  Q145: 'GB', Q31: 'BE', Q55: 'NL', Q39: 'CH', Q40: 'AT', Q41: 'GR', 'Q43': 'TR',
  Q159: 'RU', Q148: 'CN', Q884: 'KR', Q881: 'VN', Q252: 'ID', Q869: 'TH', Q822: 'LB',
  Q796: 'IQ', Q79: 'EG', Q1028: 'MA', Q774: 'GT', Q96: 'MX', Q414: 'AR', Q155: 'BR',
  Q298: 'CL', Q419: 'PE', Q750: 'BO', Q717: 'VE', Q408: 'AU', Q664: 'NZ', Q668: 'IN',
  Q843: 'PK', Q902: 'BD', Q334: 'SG', Q833: 'MY', Q928: 'PH', Q17495: 'HK',
}
const WIKIDATA_ADMIN_INSTANCE_OF = new Set(['Q515', 'Q3957', 'Q3455524', 'Q6256', 'Q1093829', 'Q123705'])

// Names shared by literally every town in a region — "Parque Central" in
// Guatemala, "Old Town" anywhere — where the unqualified name is actively
// misleading rather than just imprecise. For these, city-qualified search is
// tried FIRST, not last.
const GENERIC_NAME_PATTERNS = [
  'parque central', 'plaza central', 'plaza principal', 'parque principal',
  'mercado central', 'central market', 'old town', 'town square', 'main street',
  'main square', 'city center', 'city centre', 'zocalo', 'zócalo', 'central plaza',
]

// Per-country provider order, extended from logged evidence, not guesswork.
// Default order is ['mapbox', 'wikidata', 'geoapify']. Japan is flipped to
// wikidata-first here because the 30-place fixture showed Mapbox resolving
// ~1/5 Kyoto landmarks against every query strategy tried, while Wikidata's
// own entity descriptions named the correct city outright ("Zen Buddhist
// temple in Kyoto, Japan") — not worth paying for 3 failing Mapbox rungs
// before getting there.
const PROVIDER_ROUTING = {
  JP: ['wikidata', 'mapbox', 'geoapify'],
}
const DEFAULT_PROVIDER_ORDER = ['mapbox', 'wikidata', 'geoapify']

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

function guessWikidataLanguage(countryCode) {
  const map = {
    JP: 'ja', TH: 'th', TR: 'tr', IT: 'it', ES: 'es', FR: 'fr', CN: 'zh', KR: 'ko',
    VN: 'vi', ID: 'id', GT: 'es', MX: 'es', AR: 'es', BO: 'es', CL: 'es', PE: 'es',
    PT: 'pt', BR: 'pt', DE: 'de', AT: 'de', CH: 'de', GR: 'el', RU: 'ru', EG: 'ar',
    MA: 'ar', IQ: 'ar', LB: 'ar', IN: 'hi', PK: 'ur', BD: 'bn', PH: 'tl',
  }
  return map[countryCode] ?? 'en'
}

// Minimal semaphore — no external dependency needed for a cap this small.
// One shared limiter across all three providers: they're independent
// services, but the goal (bound total in-flight requests from this process)
// is the same for each.
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
const wikidataLimit = createLimiter(WIKIDATA_CONCURRENCY_LIMIT)
const geoapifyLimit = createLimiter(GEOAPIFY_CONCURRENCY_LIMIT)

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const MAX_RETRY_AFTER_MS = 8000 // cap how long we'll honor a server-requested wait — long enough for Wikidata's observed 6s, not so long a single stop stalls the whole itinerary

// Wraps a fetch-returning thunk with exponential backoff on 429, distinct
// from a genuine empty result — rate-limiting is an operational problem, a
// miss is a data problem, and collapsing them in the logs hides which one is
// actually happening in production. Prefers the server's own Retry-After
// header when present (confirmed live: Wikidata returns 429 with
// "retry-after: 6" under bursty test traffic — a fixed exponential guess
// would have kept retrying too fast against an explicit instruction to wait).
async function fetchWithBackoff(fn) {
  for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
    const res = await fn()
    if (res.status !== 429) return res
    if (attempt === MAX_429_RETRIES) return res
    const retryAfterHeader = Number(res.headers?.get?.('retry-after'))
    const backoff = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
      ? Math.min(retryAfterHeader * 1000, MAX_RETRY_AFTER_MS)
      : BACKOFF_BASE_MS * 2 ** attempt + Math.random() * 100
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
      result = { candidate: normalizeMapboxFeature(data.features?.[0]), rateLimited: false }
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
    matchedName: p.name ?? null,
  }
}

// ---------------------------------------------------------------------------
// Wikidata — free, no key. Search (wbsearchentities) -> entity claims
// (Special:EntityData) -> a batched label lookup for the claimed admin
// area/country. Only the top search hit is tried, to bound latency; if it
// fails validation the stop falls through to Geoapify rather than working
// through further Wikidata candidates.
// ---------------------------------------------------------------------------

async function wikidataFetchJson(url) {
  const res = await wikidataLimit(() => fetchWithBackoff(() => fetch(url, { headers: { 'User-Agent': WIKIMEDIA_USER_AGENT } })))
  if (res.status === 429) return { error: 'rate-limited' }
  if (!res.ok) return { error: `non-OK response ${res.status}` }
  return { data: await res.json() }
}

async function wikidataSearch(query, language) {
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(query)}&language=${language}&format=json&limit=3&type=item`
  const { data, error } = await wikidataFetchJson(url)
  if (error) return { hits: [], error }
  return { hits: data.search ?? [], error: null }
}

async function wikidataGetClaims(qid) {
  const url = `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`
  const { data, error } = await wikidataFetchJson(url)
  if (error) return { claims: null, error }
  return { claims: data.entities?.[qid]?.claims ?? null, error: null }
}

async function wikidataGetLabels(qids) {
  if (qids.length === 0) return {}
  const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qids.join('|')}&props=labels&languages=en&format=json`
  const { data, error } = await wikidataFetchJson(url)
  if (error) return {}
  const labels = {}
  for (const qid of qids) {
    labels[qid] = data.entities?.[qid]?.labels?.en?.value ?? null
  }
  return labels
}

function firstEntityId(claims, property) {
  return claims?.[property]?.[0]?.mainsnak?.datavalue?.value?.id ?? null
}

async function wikidataForward(searchName, name, cityInfo) {
  const query = searchName || name
  const cacheKey = normalizeKey(query)
  if (WIKIDATA_QUERY_CACHE.has(cacheKey)) return WIKIDATA_QUERY_CACHE.get(cacheKey)

  let result = { candidate: null, rateLimited: false }
  try {
    const lang = guessWikidataLanguage(cityInfo?.countryCode)
    let { hits, error } = await wikidataSearch(query, lang)
    if (error === 'rate-limited') {
      result = { candidate: null, rateLimited: true }
      WIKIDATA_QUERY_CACHE.set(cacheKey, result)
      return result
    }
    if (!hits.length && lang !== 'en') ({ hits } = await wikidataSearch(query, 'en'))
    if (!hits.length) {
      WIKIDATA_QUERY_CACHE.set(cacheKey, result)
      return result
    }

    const top = hits[0]
    const { claims, error: claimsError } = await wikidataGetClaims(top.id)
    if (claimsError === 'rate-limited') {
      result = { candidate: null, rateLimited: true }
      WIKIDATA_QUERY_CACHE.set(cacheKey, result)
      return result
    }
    if (!claims) {
      WIKIDATA_QUERY_CACHE.set(cacheKey, result)
      return result
    }

    const instanceOf = (claims.P31 ?? []).map((s) => s.mainsnak?.datavalue?.value?.id).filter(Boolean)
    const isRejectedType = instanceOf.some((id) => WIKIDATA_REJECT_INSTANCE_OF.has(id))
    const isBroad = instanceOf.some((id) => WIKIDATA_ADMIN_INSTANCE_OF.has(id))
    const coord = claims.P625?.[0]?.mainsnak?.datavalue?.value

    if (isRejectedType || !coord) {
      WIKIDATA_QUERY_CACHE.set(cacheKey, result)
      return result
    }

    const placeQid = firstEntityId(claims, 'P131')
    const countryQid = firstEntityId(claims, 'P17')
    const labels = await wikidataGetLabels([placeQid, countryQid].filter(Boolean))

    result = {
      candidate: {
        lat: coord.latitude,
        lng: coord.longitude,
        isBroad,
        placeName: placeQid ? labels[placeQid] ?? null : null,
        regionName: null, // not resolved — a second admin hop isn't worth the extra round trip; country + place already cover the cases seen
        countryCode: countryQid ? WIKIDATA_COUNTRY_QID_TO_ISO2[countryQid] ?? null : null,
        provider: 'wikidata',
        matchedName: top.label ?? null,
      },
      rateLimited: false,
    }
  } catch (err) {
    console.error('wikidata error', query, err)
  }

  WIKIDATA_QUERY_CACHE.set(cacheKey, result)
  return result
}

// ---------------------------------------------------------------------------
// Geoapify (OpenStreetMap-sourced) — free, keyed, 3000 req/day, no card.
// ---------------------------------------------------------------------------

async function geoapifyForward(query, proximity) {
  const key = process.env.GEOAPIFY_API_KEY
  if (!key) return { candidate: null, rateLimited: false }

  const cacheKey = normalizeKey(`${query}|${proximity ? `${proximity.lat},${proximity.lng}` : ''}`)
  if (GEOAPIFY_QUERY_CACHE.has(cacheKey)) return GEOAPIFY_QUERY_CACHE.get(cacheKey)

  let url = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(query)}&apiKey=${key}&limit=1`
  if (proximity) url += `&bias=proximity:${proximity.lng},${proximity.lat}`

  let result = { candidate: null, rateLimited: false }
  try {
    const res = await geoapifyLimit(() => fetchWithBackoff(() => fetch(url)))
    if (res.status === 429) {
      console.error('geoapify rate-limited (exhausted retries)', query)
      result = { candidate: null, rateLimited: true }
    } else if (!res.ok) {
      console.error('geoapify non-OK response', query, res.status)
    } else {
      const data = await res.json()
      result = { candidate: normalizeGeoapifyResult(data.results?.[0]), rateLimited: false }
    }
  } catch (err) {
    console.error('geoapify error', query, err)
  }

  GEOAPIFY_QUERY_CACHE.set(cacheKey, result)
  return result
}

function normalizeGeoapifyResult(r) {
  if (!r || typeof r.lat !== 'number' || typeof r.lon !== 'number') return null
  return {
    lat: r.lat,
    lng: r.lon,
    isBroad: GEOAPIFY_BROAD_TYPES.has(r.result_type),
    placeName: r.city ?? null,
    regionName: r.state ?? null,
    countryCode: r.country_code ? r.country_code.toUpperCase() : null,
    provider: 'geoapify',
    matchedName: r.formatted ?? null,
  }
}

// ---------------------------------------------------------------------------
// Shared context/distance validation — same rule for every provider, because
// a wrong pin from a free source is exactly as damaging as one from a paid
// one.
// ---------------------------------------------------------------------------

// Exact string equality on place names is too brittle: Mapbox/Wikidata/
// Geoapify frequently return the LOCAL-LANGUAGE name ("Roma" for target
// "Rome", "Praha" for "Prague") or a finer administrative unit ("Fatih" for
// "Istanbul") for what is genuinely the same place. Real measurements: Rome/
// Roma 0.9km apart, Prague/Praha 0.22km, Istanbul/Fatih 1.96km — all the same
// place. The original wrong-town bug this validation exists to catch (Parque
// Central resolving in the neighboring town of Santa María de Jesús) was
// 7.5km. CONTEXT_ALIAS_KM sits between those two clusters, based on that
// data, not a guess.
const CONTEXT_ALIAS_KM = 5

function placeNamesMatch(a, b) {
  const na = normalizeKey(a)
  const nb = normalizeKey(b)
  return na === nb || na.includes(nb) || nb.includes(na)
}

// When the place name doesn't match by string, check whether it's the same
// place under a different label/granularity by independently geocoding it
// and comparing distance to the target city's own anchor — rather than
// trusting a fragile string comparison to be the final word.
async function isContextAlias(candidatePlaceName, cityCenter) {
  if (!cityCenter) return false
  const aliasInfo = await geocodeCity(candidatePlaceName)
  if (!aliasInfo) return false
  return haversineKm(cityCenter, aliasInfo) <= CONTEXT_ALIAS_KM
}

async function evaluateCandidate(candidate, ctx) {
  if (!candidate) return { accept: false, reason: 'no result' }
  if (candidate.isBroad) return { accept: false, reason: 'fell back to an administrative-area match, not a specific place' }

  const cityMatches = candidate.placeName && ctx.targetCityName && placeNamesMatch(candidate.placeName, ctx.targetCityName)
  const regionMatches = candidate.regionName && ctx.targetRegionName && normalizeKey(candidate.regionName) === normalizeKey(ctx.targetRegionName)
  const countryMatches = candidate.countryCode && ctx.targetCountryCode && candidate.countryCode === ctx.targetCountryCode
  const distanceKm = ctx.cityCenter ? haversineKm(ctx.cityCenter, candidate) : null

  if (ctx.tier === 'day-trip') {
    // Only reached when the stop had no usable locality to anchor against —
    // context can't require an exact place match here by design, since the
    // whole point of this tier is a stop genuinely not in the anchor city.
    // Country is the reliable signal; distance is the generous, primary gate.
    if (candidate.placeName && !cityMatches && !regionMatches && !countryMatches) {
      return { accept: false, reason: `wrong country (resolved in ${candidate.placeName}, country ${candidate.countryCode ?? 'unknown'})` }
    }
    if (distanceKm !== null && distanceKm > DAY_TRIP_DISTANCE_CEILING_KM) {
      return { accept: false, reason: `too far (${distanceKm.toFixed(1)}km > ${DAY_TRIP_DISTANCE_CEILING_KM}km day-trip ceiling)` }
    }
    return { accept: true, distanceKm }
  }

  // in-city tier (also used for day-trip stops anchored at their own
  // locality — see resolveValidationAnchor below): context.place match is
  // the primary gate. A same-named place whose context.place points at a
  // genuinely different town is rejected outright, regardless of distance.
  // This is the fix for the Parque Central case: it landed only 7.5km
  // outside Antigua, close enough to pass any reasonable flat distance
  // ceiling, but its context.place was "Santa María de Jesús" — a different
  // town's plaza.
  if (candidate.placeName) {
    if (!cityMatches && !(await isContextAlias(candidate.placeName, ctx.cityCenter))) {
      return { accept: false, reason: `context mismatch — resolved in "${candidate.placeName}", not "${ctx.targetCityName}"` }
    }
    if (distanceKm !== null && distanceKm > IN_CITY_DISTANCE_CEILING_KM) {
      return { accept: false, reason: `too far (${distanceKm.toFixed(1)}km > ${IN_CITY_DISTANCE_CEILING_KM}km ceiling) despite matching context` }
    }
    return { accept: true, distanceKm }
  }

  // No context.place returned at all — fall back to distance-only, since
  // there's nothing to validate against.
  if (distanceKm !== null && distanceKm > IN_CITY_DISTANCE_CEILING_KM) {
    return { accept: false, reason: `too far (${distanceKm.toFixed(1)}km > ${IN_CITY_DISTANCE_CEILING_KM}km ceiling), no context to validate against` }
  }
  return { accept: true, distanceKm }
}

// ---------------------------------------------------------------------------
// City/locality anchor lookup — used both for the trip's base city and for a
// day-trip stop's own locality (Nara, for a Kyoto-based trip).
// ---------------------------------------------------------------------------

async function geocodeCity(place) {
  const key = normalizeKey(place)
  if (CITY_CACHE.has(key)) return CITY_CACHE.get(key)

  // Try the narrow, city-level types first. Many countries reuse the same
  // name for both a city and its enclosing region (Japan's Nara City/Nara
  // Prefecture is the case that surfaced this) — searching with 'region'
  // included from the start let Mapbox rank the prefecture first, whose
  // broad centroid sat 47km from the actual city and made every stop in it
  // fail the distance ceiling. Only fall back to the wider set (which
  // includes region/country) when the narrow search finds nothing, so a
  // genuine region/country-level anchor (unusual, but possible) still works.
  let { candidate } = await mapboxForward(place, { types: 'place,locality,district' })
  if (!candidate) {
    ;({ candidate } = await mapboxForward(place, { types: 'place,locality,region,district,country' }))
  }
  const result = candidate ? { lat: candidate.lat, lng: candidate.lng, regionName: candidate.regionName, countryCode: candidate.countryCode } : null

  CITY_CACHE.set(key, result)
  return result
}

// A day-trip stop with a real locality (Nara, for a Kyoto trip) gets the
// SAME strict validation an in-city stop gets, just anchored at its own
// locality instead of the trip's base city — this is what actually catches
// a same-named-temple-elsewhere-in-Japan mismatch, which a country+200km
// check structurally cannot. Falls back to the loose country/distance
// tier when no locality was supplied (older data, or the model omitted it).
async function resolveValidationAnchor(stop, baseCityInfo) {
  if (stop.proximity !== 'day-trip' || !stop.locality || normalizeKey(stop.locality) === normalizeKey(stop.city)) {
    return { targetCityName: stop.city, targetRegionName: baseCityInfo?.regionName ?? null, targetCountryCode: baseCityInfo?.countryCode ?? null, cityCenter: baseCityInfo ? { lat: baseCityInfo.lat, lng: baseCityInfo.lng } : null, tier: stop.proximity === 'day-trip' ? 'day-trip' : 'in-city' }
  }

  const localityInfo = await geocodeCity(stop.locality)
  if (!localityInfo) {
    // Couldn't anchor the claimed locality itself — fall back to the loose tier.
    return { targetCityName: stop.city, targetRegionName: baseCityInfo?.regionName ?? null, targetCountryCode: baseCityInfo?.countryCode ?? null, cityCenter: baseCityInfo ? { lat: baseCityInfo.lat, lng: baseCityInfo.lng } : null, tier: 'day-trip' }
  }

  if (baseCityInfo) {
    const localityDistanceFromBase = haversineKm(baseCityInfo, localityInfo)
    if (localityDistanceFromBase > DAY_TRIP_DISTANCE_CEILING_KM) {
      console.log(`geocode warning: claimed locality "${stop.locality}" is ${localityDistanceFromBase.toFixed(0)}km from "${stop.city}" — beyond the day-trip ceiling, falling back to loose validation`)
      return { targetCityName: stop.city, targetRegionName: baseCityInfo.regionName, targetCountryCode: baseCityInfo.countryCode, cityCenter: { lat: baseCityInfo.lat, lng: baseCityInfo.lng }, tier: 'day-trip' }
    }
  }

  return { targetCityName: stop.locality, targetRegionName: localityInfo.regionName, targetCountryCode: localityInfo.countryCode, cityCenter: { lat: localityInfo.lat, lng: localityInfo.lng }, tier: 'in-city' }
}

// ---------------------------------------------------------------------------
// Per-stop resolution: retry ladder x provider routing x validation
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

async function tryMapbox(rungs, ctx) {
  const attempted = []
  let rateLimited = false
  for (const [rungName, query] of rungs) {
    attempted.push(`mapbox:${rungName}`)
    const { candidate, rateLimited: wasLimited } = await mapboxForward(query, { proximity: ctx.cityCenter })
    if (wasLimited) rateLimited = true
    if (!candidate) continue
    const verdict = await evaluateCandidate(candidate, ctx)
    if (verdict.accept) return { winner: { candidate, provider: 'mapbox', wonBy: rungName }, attempted, rateLimited }
    console.log(`geocode rung rejected (${verdict.reason}): "${query}" [mapbox]`)
  }
  return { winner: null, attempted, rateLimited }
}

async function tryWikidata(name, searchName, ctx, wikidataBudget) {
  // Bounds worst-case latency and rate-limit exposure regardless of how many
  // stops nominally route to Wikidata in one itinerary — live testing showed
  // 5+ concurrent Japan stops (each up to 3 sequential Wikidata calls) can
  // trip Wikidata's own edge rate limiter, pushing itinerary latency to
  // 30-60s+. Checked-then-decremented synchronously (no await in between),
  // safe under Node's single-threaded event loop.
  if (wikidataBudget.remaining <= 0) {
    return { winner: null, attempted: ['wikidata:skipped-budget-exhausted'], rateLimited: false }
  }
  wikidataBudget.remaining--

  const query = searchName || name
  const { candidate, rateLimited } = await wikidataForward(searchName, name, { countryCode: ctx.targetCountryCode })
  if (!candidate) return { winner: null, attempted: ['wikidata:search'], rateLimited }
  const verdict = await evaluateCandidate(candidate, ctx)
  if (verdict.accept) return { winner: { candidate, provider: 'wikidata', wonBy: 'search' }, attempted: ['wikidata:search'], rateLimited }
  console.log(`geocode rung rejected (${verdict.reason}): "${query}" [wikidata]`)
  return { winner: null, attempted: ['wikidata:search'], rateLimited }
}

async function tryGeoapify(name, searchName, city, ctx) {
  const query = `${searchName || name}, ${city}`
  const { candidate, rateLimited } = await geoapifyForward(query, ctx.cityCenter)
  if (!candidate) return { winner: null, attempted: ['geoapify:search'], rateLimited }
  const verdict = await evaluateCandidate(candidate, ctx)
  if (verdict.accept) return { winner: { candidate, provider: 'geoapify', wonBy: 'search' }, attempted: ['geoapify:search'], rateLimited }
  console.log(`geocode rung rejected (${verdict.reason}): "${query}" [geoapify]`)
  return { winner: null, attempted: ['geoapify:search'], rateLimited }
}

async function geocodeOne(stop, cityInfo, wikidataBudget) {
  const { name, city, searchName } = stop
  const normalizedName = normalizeSearchName(name)
  const rungs = buildRungs(name, searchName, city, normalizedName)
  const ctx = await resolveValidationAnchor(stop, cityInfo)

  const providerOrder = PROVIDER_ROUTING[ctx.targetCountryCode] ?? DEFAULT_PROVIDER_ORDER

  const attempted = []
  let winner = null
  let anyRateLimited = false

  for (const provider of providerOrder) {
    let outcome
    if (provider === 'mapbox') outcome = await tryMapbox(rungs, ctx)
    else if (provider === 'wikidata') outcome = await tryWikidata(name, searchName, ctx, wikidataBudget)
    else outcome = await tryGeoapify(name, searchName, city, ctx)

    attempted.push(...outcome.attempted)
    if (outcome.rateLimited) anyRateLimited = true
    if (outcome.winner) {
      winner = outcome.winner
      break
    }
  }

  if (winner) {
    console.log(`geocode resolved "${name}, ${city}" via ${winner.provider}:${winner.wonBy} (attempted: ${attempted.join(', ')})`)
  } else {
    console.log(`geocode exhausted all providers for "${name}, ${city}" (attempted: ${attempted.join(', ')}${anyRateLimited ? ', RATE-LIMITED' : ''})`)
  }

  return { winner, attempted, rateLimited: anyRateLimited && !winner }
}

// Geocodes every stop in parallel. Returns a new array of stops with lat/lng
// attached, or unlocatable: true (never fake coordinates, never drop the
// stop). Silent degradation of this pipeline is the worst failure mode this
// product has — geocoding failing quietly means the core map-aware feature
// (clustering, ordering, travel times) turns itself off with no visible
// signal — so a >20% per-itinerary failure rate logs loudly, by name, with
// exactly which rungs/providers were tried and whether the failure was a
// genuine miss or rate-limiting, rather than only showing up as a support
// screenshot.
export async function geocodeStops(stops) {
  // Phase 1: geocode each distinct city AND each distinct day-trip locality
  // once (cached) — both serve as proximity bias and validation anchors.
  const uniquePlaces = [...new Set(stops.flatMap((s) => [s.city, s.locality]).filter(Boolean))].map(normalizeKey)
  const uniquePlacesDeduped = [...new Set(uniquePlaces)]
  const placeResults = await Promise.all(uniquePlacesDeduped.map((p) => geocodeCity(p)))
  const cityInfoByPlace = new Map(uniquePlacesDeduped.map((p, i) => [p, placeResults[i]]))

  // Phase 2: geocode every stop in parallel; each stop's own ladder runs
  // sequentially (rung by rung, provider by provider) internally, but stops
  // don't wait on each other. The per-provider concurrency limiters cap the
  // actual number of in-flight requests across all stops at once. The
  // Wikidata budget is shared and per-itinerary (fresh each call), not
  // per-stop — see tryWikidata.
  const wikidataBudget = { remaining: WIKIDATA_MAX_ATTEMPTS_PER_ITINERARY }
  const results = await Promise.all(stops.map((s) => geocodeOne(s, cityInfoByPlace.get(normalizeKey(s.city)), wikidataBudget)))

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
