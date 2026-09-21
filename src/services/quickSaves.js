import { getSupabaseClient } from './supabaseClient'

// Bucket List <-> itinerary/Passport cross-links (see App.jsx's StopCard,
// TripPage.jsx's "I went on this trip", and BucketListPage.jsx's "Mark
// visited") share this module so the three call sites don't each
// reinvent "find or create my default list" / "insert a passport entry"
// independently. Every function here degrades to a no-op (returns null or
// an empty Set) rather than throwing — none of this is load-bearing for
// the core search/itinerary experience.

export async function fetchBucketListPlaceKeys() {
  const supabase = getSupabaseClient()
  if (!supabase) return new Set()
  const { data, error } = await supabase.from('bucket_list_items').select('place_key')
  if (error) {
    console.error('bucket_list_items place_key fetch error:', error)
    return new Set()
  }
  return new Set((data ?? []).map((row) => row.place_key).filter(Boolean))
}

const DEFAULT_LIST_NAME = 'My Places'

// Quiet save from an itinerary stop — no list picker; uses the traveler's
// oldest list (their de facto "main" one) if they have any, or creates one
// on first use. The stop already carries lat/lng/placeKey from its own
// geocoding pass (see api/_lib/geocode.js), so this never calls the geocode
// endpoint again.
export async function saveStopToBucketList(userId, stop) {
  const supabase = getSupabaseClient()
  if (!supabase) return null

  const { data: lists, error: listsError } = await supabase
    .from('bucket_lists')
    .select('id')
    .order('created_at', { ascending: true })
    .limit(1)
  if (listsError) {
    console.error('bucket_lists lookup error:', listsError)
    return null
  }

  let listId = lists?.[0]?.id
  if (!listId) {
    const { data: created, error: createError } = await supabase
      .from('bucket_lists')
      .insert({ owner: userId, name: DEFAULT_LIST_NAME })
      .select()
      .single()
    if (createError) {
      console.error('bucket_lists auto-create error:', createError)
      return null
    }
    listId = created.id
  }

  const { data: item, error: itemError } = await supabase
    .from('bucket_list_items')
    .insert({
      list_id: listId,
      place_name: stop.name,
      city: stop.city || null,
      lat: stop.unlocatable ? null : stop.lat ?? null,
      lng: stop.unlocatable ? null : stop.lng ?? null,
      place_key: stop.placeKey || null,
    })
    .select()
    .single()
  if (itemError) {
    console.error('bucket_list_items insert error:', itemError)
    return null
  }
  return item
}

// Used by both "Travel -> Passport" (TripPage.jsx, one call per confirmed
// stop) and "Bucket List -> Passport" (BucketListPage.jsx) — a passport
// entry never needs geocoding here, since both source a place that's
// already been resolved (an itinerary stop, or a bucket-list item).
export async function createPassportEntryFromPlace(userId, { name, city, lat, lng }) {
  const supabase = getSupabaseClient()
  if (!supabase) return null
  const { data, error } = await supabase
    .from('passport_entries')
    .insert({ owner: userId, place_name: name, city: city || null, lat: lat ?? null, lng: lng ?? null })
    .select()
    .single()
  if (error) {
    console.error('passport_entries insert error:', error)
    return null
  }
  return data
}
