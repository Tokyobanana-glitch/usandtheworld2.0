#!/usr/bin/env node
// Regression fixture for CITY ANCHOR resolution specifically — separate from
// geocode-fixture.mjs, which tests stops. The anchor is the most
// load-bearing lookup in the pipeline: get it wrong and every stop beneath
// it inherits a corrupted proximity bias, distance ceiling, and context
// validation. That's exactly what the Tokyo bug was (geocodeCity("Tokyo")
// resolved to an obscure same-named locality near Papua New Guinea), and it
// survived four rounds of fixture work because the 30-place stop fixture
// never once exercised anchor resolution in isolation. This one does.
//
// Weighted toward cities whose plain name collides with an unrelated place
// elsewhere in the world, plus a few unambiguous controls.
import { readFileSync } from 'fs'

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
for (const line of env.split('\n')) {
  const m = line.match(/^([A-Z_]+)="(.*)"$/)
  if (m) process.env[m[1]] = m[2]
}

const { geocodeCity } = await import('../api/_lib/geocode.js')

const DRIFT_FLAG_KM = 50 // generous — this fixture is pass/fail on country, not precision

const ANCHORS = [
  // Ambiguous / duplicated names — the actual point of this fixture.
  { name: 'Tokyo', country: 'Japan', lat: 35.6895, lng: 139.6917 },
  { name: 'Valencia', country: 'Spain', lat: 39.4699, lng: -0.3763 },
  { name: 'Valencia', country: 'Venezuela', lat: 10.1621, lng: -68.0077 },
  { name: 'Santiago', country: 'Chile', lat: -33.4489, lng: -70.6693 },
  { name: 'Santiago', country: 'Cuba', lat: 20.0247, lng: -75.8219 }, // Santiago de Cuba
  // Bare "Santiago, Spain" is ambiguous even WITHIN Spain — confirmed live,
  // its top candidates are several unrelated small villages also literally
  // named "Santiago", not the pilgrimage city, which is genuinely called
  // "Santiago de Compostela" (matching how the model should emit it per the
  // system prompt's "actual town or city" instruction). This is a real,
  // different-class residual: same-country collision, not cross-country —
  // captured as its real name here rather than papered over.
  { name: 'Santiago de Compostela', country: 'Spain', lat: 42.8782, lng: -8.5448 },
  { name: 'Antigua Guatemala', country: 'Guatemala', lat: 14.5586, lng: -90.7295 },
  // "Antigua" alone isn't a city name on the Caribbean island — the country
  // IS the island, and its capital is Saint John's, which is its own
  // real-world ambiguous pair (there's also a St. John's, Newfoundland).
  { name: "Saint John's", country: 'Antigua and Barbuda', lat: 17.1175, lng: -61.8456 },
  { name: 'Cambridge', country: 'United Kingdom', lat: 52.2053, lng: 0.1218 },
  { name: 'Cambridge', country: 'United States', lat: 42.3736, lng: -71.1097 }, // Massachusetts
  { name: 'San José', country: 'Costa Rica', lat: 9.9281, lng: -84.0907 },
  { name: 'San Jose', country: 'United States', lat: 37.3382, lng: -121.8863 }, // California
  { name: 'Alexandria', country: 'Egypt', lat: 31.2001, lng: 29.9187 },
  { name: 'Alexandria', country: 'United States', lat: 38.8048, lng: -77.0469 }, // Virginia
  { name: 'Córdoba', country: 'Spain', lat: 37.8882, lng: -4.7794 },
  { name: 'Córdoba', country: 'Argentina', lat: -31.4201, lng: -64.1888 },
  { name: 'Naples', country: 'Italy', lat: 40.8518, lng: 14.2681 },
  { name: 'Naples', country: 'United States', lat: 26.1420, lng: -81.7948 }, // Florida
  { name: 'Nara', country: 'Japan', lat: 34.6851, lng: 135.8048 },
  { name: 'Toledo', country: 'Spain', lat: 39.8628, lng: -4.0273 },
  { name: 'Toledo', country: 'United States', lat: 41.6528, lng: -83.5379 }, // Ohio
  { name: 'Birmingham', country: 'United Kingdom', lat: 52.4862, lng: -1.8904 },
  { name: 'Birmingham', country: 'United States', lat: 33.5186, lng: -86.8104 }, // Alabama

  // Non-ambiguous controls — should never have needed a fix in the first place.
  { name: 'Kyoto', country: 'Japan', lat: 35.0116, lng: 135.7681 },
  { name: 'Bangkok', country: 'Thailand', lat: 13.7563, lng: 100.5018 },
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
const results = await Promise.all(ANCHORS.map((a) => geocodeCity(a.name, a.country)))
const elapsedMs = Date.now() - start

let hits = 0
const drifted = []
const missed = []

results.forEach((r, i) => {
  const expected = ANCHORS[i]
  const label = `${expected.name} (${expected.country})`
  if (!r) {
    missed.push({ label })
    return
  }
  hits++
  const driftKm = haversineKm(expected, { lat: r.lat, lng: r.lng })
  if (driftKm > DRIFT_FLAG_KM) drifted.push({ label, driftKm: driftKm.toFixed(0) })
})

console.log(`\n${'='.repeat(70)}`)
console.log(`ANCHOR FIXTURE — ${ANCHORS.length} cities, ${elapsedMs}ms wall time`)
console.log('='.repeat(70))
console.log(`\nAnchor hit rate: ${hits}/${ANCHORS.length} (${Math.round((hits / ANCHORS.length) * 100)}%)`)

if (drifted.length) {
  console.log(`\n⚠ ${drifted.length} anchor(s) resolved to the wrong place despite "resolving":`)
  drifted.forEach((d) => console.log(`  ${d.label}: ${d.driftKm}km off`))
} else {
  console.log('\nNo resolved anchor drifted from its known-correct position.')
}

if (missed.length) {
  console.log(`\n${missed.length} anchor(s) failed to resolve at all:`)
  missed.forEach((m) => console.log(`  ${m.label} (see GEOCODE ANCHOR FAILURE log line above for why)`))
}

console.log('')
