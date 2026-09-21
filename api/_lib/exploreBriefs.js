import Anthropic from '@anthropic-ai/sdk'
import { getVercelOidcToken } from '@vercel/oidc'
import { getSupabase } from './supabase.js'

// Small, deliberate duplication of generateAnswer.js's getClient/createMessage
// rather than importing them — this module has its own, much smaller schema
// and prompt, and keeping it fully independent means a future change to the
// itinerary generation path can't accidentally affect brief generation (or
// vice versa) through a shared helper neither file's comments would flag.
async function getClient() {
  if (process.env.ANTHROPIC_API_KEY) return new Anthropic()
  const token = await getVercelOidcToken()
  return new Anthropic({ baseURL: 'https://ai-gateway.vercel.sh', apiKey: '', authToken: token })
}

async function createMessage(anthropic, params) {
  const stream = anthropic.messages.stream(params)
  return stream.finalMessage()
}

const BRIEF_SCHEMA = {
  type: 'object',
  properties: {
    city: { type: 'string' },
    country: { type: 'string' },
    whyNow: {
      type: 'string',
      description:
        '2-4 warm, specific sentences on why this city is worth visiting soon — a real seasonal reason, a current event, a recently opened/reopened attraction, or genuinely good current conditions, grounded in what you found searching. Not generic destination marketing copy that could describe any city at any time.',
    },
    highlights: {
      type: 'array',
      description: '4-6 real, currently-open, named places a first-time-or-return visitor should know about, each with exactly one line on why it matters.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          line: { type: 'string' },
        },
        required: ['name', 'line'],
        additionalProperties: false,
      },
    },
    priceLevel: {
      type: 'string',
      description:
        'A rough current daily cost band for a typical traveler (e.g. "$60-90/day for a mid-range budget"), only when you found real current pricing information to support it. If you cannot confirm current costs via search, return "Pricing varies — check current listings" rather than invent a number.',
    },
    bestMonths: { type: 'string', description: 'The genuinely best months to visit, based on weather/season/crowd patterns you can support.' },
    sources: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          url: { type: 'string' },
        },
        required: ['title', 'url'],
        additionalProperties: false,
      },
    },
  },
  required: ['city', 'country', 'whyNow', 'highlights', 'priceLevel', 'bestMonths', 'sources'],
  additionalProperties: false,
}

const BRIEF_SYSTEM_PROMPT = `You are writing a short, editorial "why go now" travel brief for one city, for a travel app's Explore feed. You have live web search — use it for anything time-sensitive or checkable: current events, seasonal conditions, prices, and the specific named places you mention. Do not rely on memory alone for anything checkable.

Write "whyNow" as 2-4 warm, specific sentences on why this city is worth visiting soon — a real seasonal reason, a current event, a recently opened/reopened attraction, or genuinely good current conditions, grounded in what you actually found searching. Not generic destination marketing copy that could describe any city at any time.

Pick 4-6 real, currently-open, named places for "highlights" — landmarks, neighborhoods, restaurants, or experiences a first-time-or-return visitor should know about — each with exactly one line explaining why it matters. Verify via search that each is still open and operating before including it; if you can't confirm a well-known place is still there, leave it out rather than include it from memory.

Set "priceLevel" to a rough current daily cost band for a typical traveler (e.g. "$60-90/day for a mid-range budget") only when you found real current pricing information to support it. If you cannot confirm current costs via search, return "Pricing varies — check current listings" rather than invent a number — a wrong price is worse than no price.

Set "bestMonths" to the genuinely best months to visit, based on weather/season/crowd patterns you can support via what you found.

List the real sources you used in "sources" — every factual claim in this brief should trace back to one of them. An unverifiable claim should be left out entirely, never guessed.`

// Throws on a genuine generation failure (network, malformed JSON, max_tokens
// truncation) — the caller (runWeeklyBriefGeneration) catches per-city so one
// bad generation never blocks the rest of the batch.
export async function generateExploreBrief(city, country) {
  const anthropic = await getClient()
  const requestParams = {
    model: 'claude-haiku-4-5',
    max_tokens: 4000,
    system: BRIEF_SYSTEM_PROMPT,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
    output_config: { format: { type: 'json_schema', schema: BRIEF_SCHEMA } },
  }

  let messages = [{ role: 'user', content: `Write a brief for ${city}, ${country}.` }]
  let response = await createMessage(anthropic, { ...requestParams, messages })

  for (let i = 0; i < 3 && response.stop_reason === 'pause_turn'; i++) {
    messages = [...messages, { role: 'assistant', content: response.content }]
    response = await createMessage(anthropic, { ...requestParams, messages })
  }

  if (response.stop_reason === 'max_tokens') {
    throw new Error(`Brief generation for ${city} was truncated (max_tokens)`)
  }

  const textBlock = [...response.content].reverse().find((b) => b.type === 'text')
  if (!textBlock) throw new Error(`No text response from model for ${city} (stop_reason: ${response.stop_reason})`)

  return JSON.parse(textBlock.text)
}

async function upsertBrief(brief) {
  const supabase = getSupabase()
  if (!supabase) return false
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
  if (error) {
    // explore_briefs may not exist yet (migration 006 not applied) — degrade
    // to a no-op rather than throw, exactly like every other optional-table
    // read/write in this codebase (see geocode_cache, creator_clips).
    console.error(`explore_briefs upsert failed for ${brief.city}:`, error.message)
    return false
  }
  return true
}

// A small, curated seed list — the same destinations already used as
// examples throughout the app (see TYPEWRITER_DESTINATIONS in App.jsx), so
// the very first Explore briefs a visitor sees match places the rest of the
// product already treats as flagship examples.
export const BRIEF_SEED_CITIES = [
  { city: 'Barcelona', country: 'Spain' },
  { city: 'Tokyo', country: 'Japan' },
  { city: 'Bangkok', country: 'Thailand' },
  { city: 'Istanbul', country: 'Turkey' },
  { city: 'Cape Town', country: 'South Africa' },
  { city: 'Reykjavík', country: 'Iceland' },
  { city: 'Marrakech', country: 'Morocco' },
  { city: 'Rio de Janeiro', country: 'Brazil' },
]

const BRIEFS_PER_RUN = 2 // bounds cost/latency per cron invocation — a full rotation through the seed list takes several weeks, refreshing a couple of the stalest entries each run

// Refreshes whichever seed cities have the OLDEST (or no) brief on file —
// self-balancing across runs with zero extra state, since "oldest
// generated_at, nulls first" naturally rotates through every city over time
// and re-prioritizes anything a prior run failed to generate.
export async function runWeeklyBriefGeneration() {
  const supabase = getSupabase()
  if (!supabase) return { attempted: 0, succeeded: 0, note: 'Supabase not configured' }

  let existingByCity = new Map()
  try {
    const { data, error } = await supabase.from('explore_briefs').select('city, generated_at')
    if (error) throw error
    existingByCity = new Map((data ?? []).map((row) => [row.city, row.generated_at]))
  } catch (err) {
    // Table not created yet (migration 006 not applied) — nothing to refresh
    // against, but that's not a failure; just means every city is "never
    // generated" this run, same as if the table were empty.
    console.error('explore_briefs read failed (table may not exist yet), treating all seed cities as ungenerated:', err.message)
  }

  const toRefresh = [...BRIEF_SEED_CITIES]
    .sort((a, b) => {
      const aTime = existingByCity.has(a.city) ? new Date(existingByCity.get(a.city)).getTime() : 0
      const bTime = existingByCity.has(b.city) ? new Date(existingByCity.get(b.city)).getTime() : 0
      return aTime - bTime
    })
    .slice(0, BRIEFS_PER_RUN)

  let succeeded = 0
  for (const { city, country } of toRefresh) {
    try {
      const brief = await generateExploreBrief(city, country)
      if (await upsertBrief(brief)) succeeded++
    } catch (err) {
      console.error(`explore brief generation failed for ${city}:`, err)
    }
  }

  return { attempted: toRefresh.length, succeeded }
}
