#!/usr/bin/env node
// Regression fixture for the geocoding pipeline. Run this before every future
// change to api/_lib/geocode.js — geocoding is this product's core dependency
// and it broke silently once already without anyone noticing until a
// screenshot showed a 100% failure rate on famous landmarks.
//
// Usage: node scripts/geocode-fixture.mjs
// Reads MAPBOX_TOKEN and (optionally) GOOGLE_PLACES_API_KEY from .env.local.
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

function loadEnvLocal() {
  const path = join(__dirname, '..', '.env.local')
  const text = readFileSync(path, 'utf8')
  for (const line of text.split('\n')) {
    const match = line.match(/^([A-Z_]+)="?([^"\n]*)"?$/)
    if (match) process.env[match[1]] = match[2]
  }
}
loadEnvLocal()

const { geocodeStops } = await import('../api/_lib/geocode.js')

// distanceDriftKm: flag (not fail) any accepted result more than this far from
// the known-correct coordinate — day-trip landmarks are sometimes large areas
// (a historical park, a hike), so this is generous on purpose.
const IN_CITY_DRIFT_FLAG_KM = 3
const DAY_TRIP_DRIFT_FLAG_KM = 10

const FIXTURE = [
  // --- Latin America (Guatemala) ---
  { region: 'Latin America', name: 'Arco de Santa Catalina', searchName: 'Arco de Santa Catalina', city: 'Antigua Guatemala', locality: 'Antigua Guatemala', proximity: 'in-city', lat: 14.5596, lng: -90.7343 },
  { region: 'Latin America', name: 'Iglesia de la Merced', searchName: 'Iglesia de la Merced', city: 'Antigua Guatemala', locality: 'Antigua Guatemala', proximity: 'in-city', lat: 14.5611, lng: -90.7348 },
  { region: 'Latin America', name: 'Parque Central', searchName: 'Parque Central', city: 'Antigua Guatemala', locality: 'Antigua Guatemala', proximity: 'in-city', lat: 14.5569, lng: -90.7337 }, // generic name
  { region: 'Latin America', name: 'Mercado de Artesanías', searchName: 'Mercado de Artesanías', city: 'Antigua Guatemala', locality: 'Antigua Guatemala', proximity: 'in-city', lat: 14.5599, lng: -90.7395 }, // generic-ish name
  { region: 'Latin America', name: 'Pacaya Volcano', searchName: 'Volcán de Pacaya', city: 'Antigua Guatemala', locality: 'San Vicente Pacaya', proximity: 'day-trip', lat: 14.3810, lng: -90.6009 }, // legit ~50km day trip, real locality differs

  // --- Japan (Kyoto) — local-language divergence + known coverage gap ---
  { region: 'Japan', name: 'Fushimi Inari Shrine', searchName: 'Fushimi Inari Taisha', city: 'Kyoto', locality: 'Kyoto', proximity: 'in-city', lat: 34.9671, lng: 135.7727 },
  { region: 'Japan', name: 'Golden Pavilion', searchName: '金閣寺', city: 'Kyoto', locality: 'Kyoto', proximity: 'in-city', lat: 35.0394, lng: 135.7292 },
  { region: 'Japan', name: 'Kiyomizu Temple', searchName: '清水寺', city: 'Kyoto', locality: 'Kyoto', proximity: 'in-city', lat: 34.9949, lng: 135.7850 },
  { region: 'Japan', name: 'Arashiyama Bamboo Grove', searchName: '嵐山竹林の道', city: 'Kyoto', locality: 'Kyoto', proximity: 'in-city', lat: 35.0094, lng: 135.6693 },
  { region: 'Japan', name: 'Todai-ji Temple (Nara day trip)', searchName: '東大寺', city: 'Kyoto', locality: 'Nara', proximity: 'day-trip', lat: 34.6890, lng: 135.8398 }, // legit ~40km day trip, real locality differs — this is the Todai-ji test case

  // --- Europe (Rome) ---
  { region: 'Europe', name: 'Colosseum', searchName: 'Colosseo', city: 'Rome', locality: 'Rome', proximity: 'in-city', lat: 41.8902, lng: 12.4922 },
  { region: 'Europe', name: 'Trevi Fountain', searchName: 'Fontana di Trevi', city: 'Rome', locality: 'Rome', proximity: 'in-city', lat: 41.9009, lng: 12.4833 },
  { region: 'Europe', name: 'Piazza Navona', searchName: 'Piazza Navona', city: 'Rome', locality: 'Rome', proximity: 'in-city', lat: 41.8992, lng: 12.4731 },
  { region: 'Europe', name: 'Vatican Museums', searchName: 'Musei Vaticani', city: 'Rome', locality: 'Rome', proximity: 'in-city', lat: 41.9065, lng: 12.4536 },
  { region: 'Europe', name: 'Villa d’Este (Tivoli day trip)', searchName: 'Villa d’Este Tivoli', city: 'Rome', locality: 'Tivoli', proximity: 'day-trip', lat: 41.9629, lng: 12.7955 }, // legit ~30km day trip, real locality differs

  // --- Europe: generic names, different country each ---
  { region: 'Europe', name: 'Plaza Mayor', searchName: 'Plaza Mayor', city: 'Madrid', locality: 'Madrid', proximity: 'in-city', lat: 40.4155, lng: -3.7074 }, // generic name
  { region: 'Europe', name: 'Old Town Square', searchName: 'Staroměstské náměstí', city: 'Prague', locality: 'Prague', proximity: 'in-city', lat: 50.0870, lng: 14.4207 }, // generic pattern

  // --- Europe: exonym divergence (Istanbul) ---
  { region: 'Europe', name: 'Hagia Sophia', searchName: 'Ayasofya', city: 'Istanbul', locality: 'Istanbul', proximity: 'in-city', lat: 41.0086, lng: 28.9802 },
  { region: 'Europe', name: 'Blue Mosque', searchName: 'Sultan Ahmet Camii', city: 'Istanbul', locality: 'Istanbul', proximity: 'in-city', lat: 41.0054, lng: 28.9768 },

  // --- Southeast Asia (Bangkok) ---
  { region: 'Southeast Asia', name: 'Wat Arun', searchName: 'Wat Arun', city: 'Bangkok', locality: 'Bangkok', proximity: 'in-city', lat: 13.7437, lng: 100.4888 },
  { region: 'Southeast Asia', name: 'Temple of the Emerald Buddha', searchName: 'Wat Phra Kaew', city: 'Bangkok', locality: 'Bangkok', proximity: 'in-city', lat: 13.7515, lng: 100.4927 },
  { region: 'Southeast Asia', name: 'Chatuchak Weekend Market', searchName: 'Chatuchak Market', city: 'Bangkok', locality: 'Bangkok', proximity: 'in-city', lat: 13.7998, lng: 100.5501 },
  { region: 'Southeast Asia', name: 'Ayutthaya Historical Park', searchName: 'Ayutthaya Historical Park', city: 'Bangkok', locality: 'Ayutthaya', proximity: 'day-trip', lat: 14.3533, lng: 100.5684 }, // legit ~80km day trip, real locality differs

  // --- Southeast Asia (Bali) ---
  { region: 'Southeast Asia', name: 'Uluwatu Temple (day trip)', searchName: 'Pura Luhur Uluwatu', city: 'Kuta, Bali', locality: 'Uluwatu, Bali', proximity: 'day-trip', lat: -8.8291, lng: 115.0849 },
  { region: 'Southeast Asia', name: 'Tegallalang Rice Terraces', searchName: 'Tegallalang Rice Terrace', city: 'Ubud, Bali', locality: 'Tegallalang, Bali', proximity: 'day-trip', lat: -8.4312, lng: 115.2778 },

  // --- US (San Francisco) ---
  { region: 'US', name: 'Golden Gate Bridge', searchName: 'Golden Gate Bridge', city: 'San Francisco', locality: 'San Francisco', proximity: 'in-city', lat: 37.8199, lng: -122.4783 },
  { region: 'US', name: 'Alcatraz Island', searchName: 'Alcatraz Island', city: 'San Francisco', locality: 'San Francisco', proximity: 'in-city', lat: 37.8267, lng: -122.4230 },
  { region: 'US', name: "Fisherman's Wharf", searchName: "Fisherman's Wharf", city: 'San Francisco', locality: 'San Francisco', proximity: 'in-city', lat: 37.8080, lng: -122.4177 },
  { region: 'US', name: 'Muir Woods (day trip)', searchName: 'Muir Woods National Monument', city: 'San Francisco', locality: 'Mill Valley', proximity: 'day-trip', lat: 37.8946, lng: -122.5811 }, // legit ~20km day trip, real locality differs

  // --- Latin America (rural small-town control) ---
  { region: 'Latin America', name: 'San Juan La Laguna Public Dock', searchName: 'San Juan La Laguna Public Dock', city: 'San Juan La Laguna', locality: 'San Juan La Laguna', proximity: 'in-city', lat: 14.6906, lng: -91.2836 },
]

function haversineKm(a, b) {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

const start = Date.now()
const results = await geocodeStops(FIXTURE)
const elapsedMs = Date.now() - start

let hits = 0
const byRegion = new Map()
const byProvider = new Map()
const drifted = []
const missed = []

results.forEach((r, i) => {
  const expected = FIXTURE[i]
  const regionStats = byRegion.get(expected.region) ?? { hit: 0, total: 0 }
  regionStats.total++

  if (r.unlocatable) {
    missed.push({ name: expected.name, region: expected.region, reason: r.unlocatableReason })
    byRegion.set(expected.region, regionStats)
    return
  }

  hits++
  regionStats.hit++
  byRegion.set(expected.region, regionStats)

  const provider = r.resolvedVia?.split(':')[0] ?? 'unknown'
  byProvider.set(provider, (byProvider.get(provider) ?? 0) + 1)

  const driftKm = haversineKm({ lat: expected.lat, lng: expected.lng }, { lat: r.lat, lng: r.lng })
  const driftCeiling = expected.proximity === 'day-trip' ? DAY_TRIP_DRIFT_FLAG_KM : IN_CITY_DRIFT_FLAG_KM
  if (driftKm > driftCeiling) {
    drifted.push({ name: expected.name, region: expected.region, driftKm: driftKm.toFixed(1), resolvedVia: r.resolvedVia })
  }
})

console.log(`\n${'='.repeat(70)}`)
console.log(`GEOCODE FIXTURE — ${FIXTURE.length} places, ${elapsedMs}ms wall time`)
console.log('='.repeat(70))
console.log(`\nOverall hit rate: ${hits}/${FIXTURE.length} (${Math.round((hits / FIXTURE.length) * 100)}%)`)

console.log('\nBy region:')
for (const [region, stats] of byRegion) {
  console.log(`  ${region.padEnd(20)} ${stats.hit}/${stats.total} (${Math.round((stats.hit / stats.total) * 100)}%)`)
}

console.log('\nBy provider (of resolved stops):')
for (const [provider, count] of byProvider) {
  console.log(`  ${provider.padEnd(10)} ${count}`)
}

if (drifted.length) {
  console.log(`\n⚠ ${drifted.length} result(s) accepted but drifted from known-correct position:`)
  drifted.forEach((d) => console.log(`  ${d.name} [${d.region}]: ${d.driftKm}km off (via ${d.resolvedVia})`))
} else {
  console.log('\nNo accepted result drifted from its known-correct position beyond the flag threshold.')
}

if (missed.length) {
  console.log(`\n${missed.length} unresolved:`)
  missed.forEach((m) => console.log(`  ${m.name} [${m.region}]: ${m.reason}`))
}

console.log('')
