import { getSupabase } from './supabase.js'

// Identifies the caller from a client-sent Supabase access token, when
// there is one. Search and itinerary generation must stay fully anonymous
// (see api/travel-assistant.js), so this deliberately never errors or
// throws when the header is missing or the token is invalid — it just
// returns null and the caller proceeds as an anonymous request. Only code
// paths that actually want to attribute a save to an account (populating
// itineraries.owner, claiming trips) should treat a null return as
// meaningful.
//
// Passing a client's own access token into the service-role client's
// auth.getUser() is the standard, safe pattern for this: it verifies the
// token's signature/expiry against Supabase Auth and returns the user it
// belongs to — it does not require the service-role key to "be" that user,
// and it never bypasses RLS on its own (nothing here queries app tables).
export async function getUserFromRequest(req) {
  const header = req.headers['authorization'] || req.headers['Authorization']
  if (!header?.startsWith('Bearer ')) return null

  const token = header.slice('Bearer '.length).trim()
  if (!token) return null

  const supabase = getSupabase()
  if (!supabase) return null

  try {
    const { data, error } = await supabase.auth.getUser(token)
    if (error || !data?.user) return null
    return data.user
  } catch (err) {
    console.error('getUserFromRequest: token validation threw', err)
    return null
  }
}
