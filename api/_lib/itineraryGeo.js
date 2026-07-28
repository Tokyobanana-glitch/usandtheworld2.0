import { geocodeStops } from './geocode.js'
import { haversineKm } from './geoMath.js'

// Named, tunable constants — no magic numbers buried in logic below.
export const WALKING_THRESHOLD_KM = 1.2 // legs shorter than this are walked; longer are driven
const WALK_SPEED_KMH = 4.5
const WALK_ROUTE_INEFFICIENCY = 1.3 // real streets aren't straight lines
const FALLBACK_DRIVING_KMH = 30 // used only if the Matrix API call fails
const LONG_LEG_MINUTES = 45
const KMEANS_ITERATIONS = 25

// Deterministic k-means (seeded by sorted position, not Math.random) — the
// scale here (a handful to a few dozen stops) makes this trivially cheap.
function kMeansAssign(points, k) {
  k = Math.min(k, points.length)
  if (k <= 1) {
    const avgLat = points.reduce((s, p) => s + p.lat, 0) / points.length
    const avgLng = points.reduce((s, p) => s + p.lng, 0) / points.length
    return { assignments: points.map(() => 0), centroids: [{ lat: avgLat, lng: avgLng }] }
  }

  const sorted = [...points].sort((a, b) => a.lat - b.lat || a.lng - b.lng)
  let centroids = Array.from({ length: k }, (_, i) => {
    const idx = Math.floor((i * sorted.length) / k)
    return { lat: sorted[idx].lat, lng: sorted[idx].lng }
  })

  let assignments = new Array(points.length).fill(0)

  for (let iter = 0; iter < KMEANS_ITERATIONS; iter++) {
    let changed = false
    for (let i = 0; i < points.length; i++) {
      let best = 0
      let bestDist = Infinity
      for (let c = 0; c < k; c++) {
        const d = haversineKm(points[i], centroids[c])
        if (d < bestDist) {
          bestDist = d
          best = c
        }
      }
      if (assignments[i] !== best) changed = true
      assignments[i] = best
    }

    const sums = Array.from({ length: k }, () => ({ lat: 0, lng: 0, count: 0 }))
    points.forEach((p, i) => {
      const c = assignments[i]
      sums[c].lat += p.lat
      sums[c].lng += p.lng
      sums[c].count++
    })
    centroids = sums.map((s, c) => (s.count > 0 ? { lat: s.lat / s.count, lng: s.lng / s.count } : centroids[c]))

    if (!changed) break
  }

  // An itinerary day can't have zero stops — steal one from the largest
  // cluster into any cluster k-means left empty.
  const counts = new Array(k).fill(0)
  assignments.forEach((a) => counts[a]++)
  for (let c = 0; c < k; c++) {
    if (counts[c] === 0) {
      const largest = counts.indexOf(Math.max(...counts))
      const idx = assignments.findIndex((a) => a === largest)
      assignments[idx] = c
      counts[largest]--
      counts[c]++
    }
  }

  return { assignments, centroids }
}

// Greedy nearest-neighbor chain over cluster centroids, anchored at the
// cluster containing the trip's first stop — gives a sensible day-to-day flow,
// not just internal-to-a-day coherence.
function orderClustersByProximity(centroids, startIdx) {
  const n = centroids.length
  const visited = new Array(n).fill(false)
  const order = [startIdx]
  visited[startIdx] = true
  for (let step = 1; step < n; step++) {
    const last = centroids[order[order.length - 1]]
    let best = -1
    let bestDist = Infinity
    for (let i = 0; i < n; i++) {
      if (visited[i]) continue
      const d = haversineKm(last, centroids[i])
      if (d < bestDist) {
        bestDist = d
        best = i
      }
    }
    order.push(best)
    visited[best] = true
  }
  return order
}

const TIME_OF_DAY_RANK = { morning: 0, midday: 1, afternoon: 2, evening: 3, night: 4 }

// Geographic ordering wins (per the brief: "fix geographic incoherence
// deterministically"). timeOfDay isn't used to reorder — only to pick which
// stop starts the nearest-neighbor chain, so the model's sense of "this is
// the morning stop" still shapes the day without overriding geography.
function orderStopsWithinDay(stops) {
  if (stops.length <= 1) return stops
  const byTimeOfDay = [...stops].sort(
    (a, b) => (TIME_OF_DAY_RANK[a.timeOfDay] ?? 2.5) - (TIME_OF_DAY_RANK[b.timeOfDay] ?? 2.5),
  )
  const start = byTimeOfDay[0]
  const chain = [start]
  let pool = stops.filter((s) => s !== start)
  let current = start
  while (pool.length) {
    let bestIdx = 0
    let bestDist = Infinity
    for (let i = 0; i < pool.length; i++) {
      const d = haversineKm(current, pool[i])
      if (d < bestDist) {
        bestDist = d
        bestIdx = i
      }
    }
    current = pool[bestIdx]
    chain.push(current)
    pool = pool.filter((_, i) => i !== bestIdx)
  }
  return chain
}

async function fetchMatrixDurations(coords) {
  const token = process.env.MAPBOX_TOKEN
  if (!token || coords.length < 2) return null

  const coordStr = coords.map((c) => `${c.lng},${c.lat}`).join(';')
  const url = `https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${coordStr}?annotations=duration,distance&access_token=${token}`

  try {
    const res = await fetch(url)
    if (!res.ok) {
      console.error('mapbox matrix non-OK response', res.status)
      return null
    }
    return await res.json()
  } catch (err) {
    console.error('mapbox matrix error', err)
    return null
  }
}

// One Matrix API call per day (driving profile) gives real travel times for
// every consecutive pair. Walking legs (under WALKING_THRESHOLD_KM) don't use
// the driving duration — a drive duration for a 400m hop is meaningless — they
// get a straight-line-distance estimate instead, so this stays one call per
// day rather than a second walking-profile call per leg.
async function buildLegsForDay(orderedGeocodedStops) {
  if (orderedGeocodedStops.length < 2) return []

  const matrix = await fetchMatrixDurations(orderedGeocodedStops)

  const legs = []
  for (let i = 0; i < orderedGeocodedStops.length - 1; i++) {
    const from = orderedGeocodedStops[i]
    const to = orderedGeocodedStops[i + 1]
    const distanceKm = haversineKm(from, to)
    const mode = distanceKm <= WALKING_THRESHOLD_KM ? 'walking' : 'driving'

    let durationMinutes
    let estimated
    if (mode === 'walking') {
      durationMinutes = Math.round(((distanceKm * WALK_ROUTE_INEFFICIENCY) / WALK_SPEED_KMH) * 60)
      estimated = true
    } else if (matrix?.durations?.[i]?.[i + 1] != null) {
      durationMinutes = Math.round(matrix.durations[i][i + 1] / 60)
      estimated = false
    } else {
      durationMinutes = Math.round((distanceKm / FALLBACK_DRIVING_KMH) * 60)
      estimated = true
    }

    legs.push({
      fromIndex: i,
      toIndex: i + 1,
      mode,
      distanceKm: Math.round(distanceKm * 10) / 10,
      durationMinutes,
      estimated,
      longLeg: durationMinutes > LONG_LEG_MINUTES,
    })
  }
  return legs
}

// Orchestrates STEP 2 + STEP 3 for a whole itinerary: geocode every stop in
// one parallel batch, re-cluster into day-sized geographic groups, order each
// day by nearest neighbor, reattach unlocatable stops without legs, then
// compute real travel-time legs. No second model call anywhere in here.
export async function enrichItinerary(itinerary) {
  const numDays = itinerary.length

  const flatRefs = []
  itinerary.forEach((day, dayIdx) => {
    day.stops.forEach((stop) => flatRefs.push({ dayIdx, stop }))
  })
  const geocoded = await geocodeStops(flatRefs.map((r) => r.stop))
  const allStops = geocoded.map((stop, i) => ({ ...stop, __originalDayIdx: flatRefs[i].dayIdx }))

  const locatable = allStops.filter((s) => !s.unlocatable)
  const unlocatable = allStops.filter((s) => s.unlocatable)

  let dayGroups
  if (locatable.length === 0) {
    dayGroups = itinerary.map(() => [])
  } else {
    const { assignments, centroids } = kMeansAssign(locatable, numDays)

    const firstLocatableStop = allStops.find((s) => !s.unlocatable)
    const anchorLocatableIdx = firstLocatableStop ? locatable.indexOf(firstLocatableStop) : 0
    const startCluster = assignments[anchorLocatableIdx] ?? 0

    const centroidOrder = orderClustersByProximity(centroids, startCluster)
    dayGroups = centroidOrder.map((clusterIdx) => locatable.filter((_, i) => assignments[i] === clusterIdx))
    while (dayGroups.length < numDays) dayGroups.push([])
  }

  dayGroups = dayGroups.map((stops) => orderStopsWithinDay(stops))

  // Lenient (non-unique) mapping used only to place unlocatable stops: whichever
  // new day ended up with the most stops originally from this stop's old day.
  function bestSlotForOldDay(oldIdx) {
    let best = 0
    let bestCount = -1
    dayGroups.forEach((stops, newIdx) => {
      const count = stops.filter((s) => s.__originalDayIdx === oldIdx).length
      if (count > bestCount) {
        bestCount = count
        best = newIdx
      }
    })
    if (bestCount > 0) return best
    return Math.min(dayGroups.length - 1, Math.round((oldIdx / Math.max(1, numDays - 1)) * (dayGroups.length - 1)))
  }

  unlocatable.forEach((stop) => {
    const slot = bestSlotForOldDay(stop.__originalDayIdx)
    dayGroups[slot] = [...dayGroups[slot], stop]
  })

  // Legs only ever connect the locatable, ordered prefix of each day's stops
  // (unlocatable stops are always appended after), so leg fromIndex/toIndex
  // line up directly with positions in the final `stops` array — no offset.
  const legsPerDay = await Promise.all(
    dayGroups.map((stops) => buildLegsForDay(stops.filter((s) => !s.unlocatable))),
  )

  // Titles: each new day claims the original day's title it overlaps with
  // most, strongest match first so two new days don't collide on one title.
  const claims = dayGroups.map((stops, newIdx) => {
    const counts = new Map()
    stops.forEach((s) => counts.set(s.__originalDayIdx, (counts.get(s.__originalDayIdx) || 0) + 1))
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1])
    return { newIdx, ranked }
  })

  const usedOriginalIdx = new Set()
  let titleConflictCount = 0
  const titles = new Array(dayGroups.length)
  const processingOrder = [...claims].sort((a, b) => (b.ranked[0]?.[1] ?? 0) - (a.ranked[0]?.[1] ?? 0))
  processingOrder.forEach(({ newIdx, ranked }) => {
    const claim = ranked.find(([origIdx]) => !usedOriginalIdx.has(origIdx))
    if (claim && itinerary[claim[0]]) {
      usedOriginalIdx.add(claim[0])
      titles[newIdx] = itinerary[claim[0]].title
      if (ranked[0] && ranked[0][0] !== claim[0]) titleConflictCount++
    } else {
      if (ranked.length) titleConflictCount++
      const names = dayGroups[newIdx].slice(0, 2).map((s) => s.name).filter(Boolean)
      titles[newIdx] = names.length ? names.join(' & ') : `Day ${newIdx + 1}`
    }
  })

  if (titleConflictCount > 0) {
    console.log(`itinerary re-clustering: ${titleConflictCount} day title(s) reassigned/synthesized due to geographic regrouping`)
  }

  return dayGroups.map((stops, i) => ({
    day: i + 1,
    title: titles[i],
    stops: stops.map(({ __originalDayIdx, ...rest }) => rest),
    legs: legsPerDay[i],
  }))
}
