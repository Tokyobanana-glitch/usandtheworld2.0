// Matches stops between an original and re-verified itinerary primarily by
// coordinates, not display name — the model rephrases the traveler-facing
// "name" cosmetically between regenerations (e.g. "Torre dos Clérigos
// (Clérigos Tower)" vs "Clérigos Tower" for the literal same place), which
// made every stop look "removed and added" even when nothing real changed.
// Coordinates for the same real place are stable across regenerations
// (searchName + locality + country hit the same persistent geocode_cache
// entry), so round to ~111m precision and match on that first. Only an
// unlocatable stop (no coordinate at all) falls back to searchName+city.
function flattenStops(itinerary) {
  const stops = []
  ;(itinerary || []).forEach((day) => (day.stops || []).forEach((s) => stops.push(s)))
  return stops
}

function roundCoord(n) {
  return Math.round(n * 1000) / 1000
}

function stopKey(stop) {
  if (typeof stop.lat === 'number' && typeof stop.lng === 'number' && !stop.unlocatable) {
    return `coord:${roundCoord(stop.lat)},${roundCoord(stop.lng)}`
  }
  const name = (stop.searchName || stop.name || '').trim().toLowerCase().replace(/\s+/g, ' ')
  const city = (stop.city || '').trim().toLowerCase()
  return `name:${name}|${city}`
}

// A stop that closed since the original check is exactly the kind of thing
// this product exists to catch — this diff is what makes a re-verify worth
// clicking, rather than just silently swapping in a new plan.
export function diffItineraries(oldPayload, newPayload) {
  const oldByKey = new Map(flattenStops(oldPayload.itinerary).map((s) => [stopKey(s), s]))
  const newByKey = new Map(flattenStops(newPayload.itinerary).map((s) => [stopKey(s), s]))

  const statusChanged = []
  const removed = []
  const added = []

  for (const [key, oldStop] of oldByKey) {
    const newStop = newByKey.get(key)
    if (!newStop) {
      removed.push({ name: oldStop.name, city: oldStop.city, oldStatus: oldStop.status })
    } else if (oldStop.status !== newStop.status) {
      statusChanged.push({
        name: newStop.name,
        city: newStop.city,
        oldStatus: oldStop.status,
        newStatus: newStop.status,
        newStatusNote: newStop.statusNote,
      })
    }
  }

  for (const [key, newStop] of newByKey) {
    if (!oldByKey.has(key)) added.push({ name: newStop.name, city: newStop.city, status: newStop.status })
  }

  return { statusChanged, removed, added, hasChanges: statusChanged.length > 0 || removed.length > 0 || added.length > 0 }
}
