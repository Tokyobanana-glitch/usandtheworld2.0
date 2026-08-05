#!/usr/bin/env node
// Tags one of your own clips to a place. Runs the SAME geocoding pipeline
// production uses (geocodeStops) on a single synthetic stop, so the
// cache_key this writes is guaranteed to match whatever key a real
// itinerary resolves that place to later — no separate normalization logic
// to keep in sync by hand.
//
// Usage:
//   node scripts/add-creator-clip.mjs \
//     --name "Tenryu-ji Temple" --city "Kyoto" --country "Japan" \
//     --video "https://youtube.com/shorts/xxxxxxxx" \
//     --caption "our sunrise walk through the bamboo grove"
//
// Reads MAPBOX_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY from .env.local
// (pull real values first: `vercel env pull .env.local`).
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

function parseArgs() {
  const args = {}
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '')
    args[key] = argv[i + 1]
  }
  return args
}

const args = parseArgs()
const { name, city, country, video, caption } = args

if (!name || !city || !country || !video) {
  console.error('Usage: node scripts/add-creator-clip.mjs --name "..." --city "..." --country "..." --video "https://..." [--caption "..."]')
  process.exit(1)
}

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local — run `vercel env pull .env.local` first.')
  process.exit(1)
}

const { geocodeStops } = await import('../api/_lib/geocode.js')
const { createClient } = await import('@supabase/supabase-js')

// A single-stop "itinerary" run through the real pipeline. proximity is
// always 'in-city' here — day-trip locality distinctions only matter when
// resolving against a trip's base city, which doesn't exist in this
// standalone context.
const [result] = await geocodeStops([
  { name, searchName: name, city, locality: city, country, proximity: 'in-city' },
])

if (!result?.placeKey) {
  console.error(`Could not resolve a place identity for "${name}, ${city}" — the geocoder itself failed. Try again, or check MAPBOX_TOKEN.`)
  process.exit(1)
}

if (result.unlocatable) {
  console.warn(`Warning: "${name}, ${city}" did not geocode to real coordinates, but the identity key is stable either way — proceeding.`)
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { error } = await supabase
  .from('creator_clips')
  .upsert({ cache_key: result.placeKey, video_url: video, caption: caption || null }, { onConflict: 'cache_key' })

if (error) {
  console.error('Failed to save clip:', error.message)
  process.exit(1)
}

console.log(`Tagged clip for "${name}, ${city}" → ${video}`)
console.log(`(place key: ${result.placeKey})`)
