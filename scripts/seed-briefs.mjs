#!/usr/bin/env node
// Populates explore_briefs for every city in BRIEF_SEED_CITIES in one pass.
// api/_lib/exploreBriefs.js's own cron (runWeeklyBriefGeneration) only
// refreshes BRIEFS_PER_RUN=2 per invocation — deliberately, to bound
// per-run cost/latency — which would take weeks to reach full coverage on a
// table that starts empty. Same generation function, same schema mapping,
// same sourcing discipline as the cron; this script just runs it for every
// seed city in one go instead of two at a time.
//
// Usage:
//   node scripts/seed-briefs.mjs
//
// Reads SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and either ANTHROPIC_API_KEY
// or VERCEL_OIDC_TOKEN from .env.local.
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

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local.')
  process.exit(1)
}

const { generateExploreBrief, BRIEF_SEED_CITIES } = await import('../api/_lib/exploreBriefs.js')
const { createClient } = await import('@supabase/supabase-js')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

let succeeded = 0
for (const { city, country } of BRIEF_SEED_CITIES) {
  process.stdout.write(`Generating brief for ${city}, ${country}… `)
  try {
    const brief = await generateExploreBrief(city, country)
    // Same column mapping as api/_lib/exploreBriefs.js's private upsertBrief
    // — duplicated here rather than exported, since that function is a
    // small, deliberate piece of the cron's own module, not a shared utility.
    const { error } = await supabase.from('explore_briefs').upsert(
      {
        city: brief.city,
        country: brief.country,
        why_now: brief.whyNow,
        highlights: brief.highlights,
        price_level: brief.priceLevel,
        best_months: brief.bestMonths,
        sources: brief.sources,
        image_url: null,
        generated_at: new Date().toISOString(),
      },
      { onConflict: 'city' },
    )
    if (error) throw error
    console.log('done')
    succeeded++
  } catch (err) {
    console.log('FAILED')
    console.error(`  ${city}: ${err.message}`)
  }
}

console.log(`\n${succeeded}/${BRIEF_SEED_CITIES.length} briefs saved.`)
if (succeeded < BRIEF_SEED_CITIES.length) process.exit(1)
