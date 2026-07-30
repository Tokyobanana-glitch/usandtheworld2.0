import { getSupabase } from './supabase.js'
import { generateSlug, normalizeQuery } from './slug.js'

// Freshness window for CACHE MATCHING only — whether a new free-text query is
// allowed to reuse an existing row instead of regenerating. This never
// applies to a direct slug read: a saved trip is a saved trip, and a viewer
// opening a link on day 20 must see exactly what was shared on day 1, not a
// silent regeneration with different stops or ordering.
export const CACHE_FRESHNESS_DAYS = 14

export { normalizeQuery }

// Exact-string match only, and only within the freshness window. Free-text
// queries will rarely collide, and that's the correct tradeoff — a near-miss
// served as a hit (two subtly different trips treated as the same) is worse
// than the cost of regenerating. This is intentionally simple: no fuzzy
// matching, no embeddings, just an indexed equality lookup.
export async function findCachedItinerary(rawQuery) {
  const supabase = getSupabase()
  if (!supabase) return null

  const normalized = normalizeQuery(rawQuery)
  const cutoff = new Date(Date.now() - CACHE_FRESHNESS_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('itineraries')
    .select('slug, payload, created_at')
    .eq('normalized_query', normalized)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('itinerary cache read error', error.message)
    return null
  }
  return data
}

// Direct slug read — deliberately has NO expiry check. A saved trip is
// storage, not a cache; it always serves the saved payload.
//
// Returns a discriminated result rather than plain null, because "this slug
// was never real" and "the database is temporarily unreachable" (e.g. a
// paused free-tier Supabase project — HTTP 540 on every request after ~7
// days of inactivity) need different messaging. Telling a viewer their link
// "may have expired or never existed" when the trip actually exists and the
// DB just paused is exactly the kind of misleading failure this product
// exists to avoid on the travel-content side; the infra side shouldn't lie
// about it either.
export async function getItineraryBySlug(slug) {
  const supabase = getSupabase()
  if (!supabase) return { status: 'error' }

  try {
    const { data, error } = await supabase
      .from('itineraries')
      .select('slug, query, payload, created_at, verified_at, source_slug')
      .eq('slug', slug)
      .maybeSingle()

    if (error) {
      console.error('itinerary slug read error', slug, error.message)
      return { status: 'error' }
    }
    if (!data) return { status: 'not-found' }
    return { status: 'ok', trip: data }
  } catch (err) {
    // A paused project or network failure can throw rather than resolve
    // with an { error } field, depending on how far the request got.
    console.error('itinerary slug read threw', slug, err)
    return { status: 'error' }
  }
}

// If this slug was ever re-verified, someone created a new row pointing back
// at it via source_slug — surface the most recent one so the original page
// can link forward to it, without ever mutating the original row itself.
export async function findNewerVersion(slug) {
  const supabase = getSupabase()
  if (!supabase) return null

  const { data, error } = await supabase
    .from('itineraries')
    .select('slug, created_at')
    .eq('source_slug', slug)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('itinerary newer-version lookup error', slug, error.message)
    return null
  }
  return data
}

export async function saveItinerary({ query, payload, sourceSlug = null }) {
  const supabase = getSupabase()
  if (!supabase) return null

  const slug = generateSlug()
  const now = new Date().toISOString()
  const { error } = await supabase.from('itineraries').insert({
    slug,
    query,
    normalized_query: normalizeQuery(query),
    payload,
    created_at: now,
    verified_at: now,
    source_slug: sourceSlug,
  })

  if (error) {
    console.error('itinerary save error', error.message)
    return null
  }
  return slug
}
