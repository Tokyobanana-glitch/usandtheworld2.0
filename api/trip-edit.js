import { getItineraryBySlug, saveItinerary } from './_lib/itineraryStore.js'
import { geocodeStops } from './_lib/geocode.js'
import { buildLegsForDay } from './_lib/itineraryGeo.js'

function isValidItinerary(itinerary) {
  return Array.isArray(itinerary) && itinerary.length > 0 && itinerary.every((day) => day && Array.isArray(day.stops))
}

// New stops added client-side only ever carry name + city — everything else
// a normal stop has (proximity, locality, country) is inferred so
// geocodeStops has the same context an original stop would.
function inferCountryHint(payload) {
  for (const day of payload.itinerary || []) {
    for (const stop of day.stops || []) {
      if (stop.country) return stop.country
    }
  }
  return undefined
}

// Recomputes legs over stops in EXACTLY the order the traveler submitted
// them — no reordering, no re-clustering. buildLegsForDay itself only knows
// how to number legs against the contiguous array it's handed, so unlocatable
// stops (which have no coordinates to route between) are filtered out before
// the call and the resulting fromIndex/toIndex are mapped back onto their
// real position in the full, traveler-ordered stops array.
async function computeDayLegs(stops) {
  const locatableWithIndex = stops
    .map((stop, i) => ({ stop, i }))
    .filter(({ stop }) => !stop.unlocatable && typeof stop.lat === 'number' && typeof stop.lng === 'number')

  const legs = await buildLegsForDay(locatableWithIndex.map(({ stop }) => stop))
  return legs.map((leg) => ({
    ...leg,
    fromIndex: locatableWithIndex[leg.fromIndex].i,
    toIndex: locatableWithIndex[leg.toIndex].i,
  }))
}

// Editing never mutates the original row — this always mints a NEW slug
// pointing back at the one being edited (source_slug), exactly like the
// re-verify path (see trip-reverify.js), so an already-shared link keeps
// showing exactly what was shared. Deliberately does NOT call
// enrichItinerary(): its k-means re-clustering and proximity reordering
// would silently discard the traveler's manual stop order and day
// assignments. Instead only the stops that are actually new (no lat/lng
// yet) get geocoded; everything else — order, day grouping, existing
// coordinates — passes through untouched, and legs are recomputed on top of
// that exact order.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const { slug, itinerary } = req.body ?? {}
  if (!slug || typeof slug !== 'string') {
    res.status(400).json({ error: "Missing 'slug' string in request body" })
    return
  }
  if (!isValidItinerary(itinerary)) {
    res.status(400).json({ error: "Missing or malformed 'itinerary' in request body" })
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
    const original = result.trip

    const countryHint = inferCountryHint(original.payload)
    const newStopRefs = []
    itinerary.forEach((day, dayIdx) => {
      day.stops.forEach((stop, stopIdx) => {
        if (typeof stop.lat !== 'number' || typeof stop.lng !== 'number') {
          newStopRefs.push({ dayIdx, stopIdx })
        }
      })
    })

    if (newStopRefs.length > 0) {
      const rawNewStops = newStopRefs.map(({ dayIdx, stopIdx }) => {
        const stop = itinerary[dayIdx].stops[stopIdx]
        return {
          name: stop.name,
          searchName: stop.searchName || stop.name,
          city: stop.city,
          proximity: stop.proximity || 'in-city',
          locality: stop.locality || stop.city,
          country: stop.country || countryHint,
        }
      })

      // Never fails the whole edit on a bad new stop — a no-match comes back
      // marked unlocatable, same as any other stop that fails to resolve.
      const geocoded = await geocodeStops(rawNewStops)
      geocoded.forEach((g, i) => {
        const { dayIdx, stopIdx } = newStopRefs[i]
        itinerary[dayIdx].stops[stopIdx] = {
          status: 'unverified',
          statusNote: null,
          category: null,
          timeOfDay: null,
          durationMinutes: null,
          priceIndicator: null,
          why: null,
          sourceUrl: null,
          ...itinerary[dayIdx].stops[stopIdx],
          ...g,
        }
      })
    }

    const editedItinerary = await Promise.all(
      itinerary.map(async (day) => ({ ...day, legs: await computeDayLegs(day.stops) })),
    )

    const newSlug = await saveItinerary({
      query: original.query,
      payload: { ...original.payload, itinerary: editedItinerary },
      sourceSlug: slug,
      revisionKind: 'edit',
    })
    if (!newSlug) {
      res.status(502).json({ error: 'Failed to save edited trip' })
      return
    }

    res.status(200).json({ newSlug })
  } catch (err) {
    console.error('trip-edit error:', err)
    res.status(502).json({ error: 'Failed to save edited trip' })
  }
}
