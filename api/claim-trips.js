import { getUserFromRequest } from './_lib/supabaseAuth.js'
import { getSupabase } from './_lib/supabase.js'

// One-time, idempotent claim of a signed-out visitor's anonymous trips onto
// their new account, run right after sign-in — see
// src/services/accountMigration.js. Never inserts or overwrites: it only
// ever flips owner on a row that's still ownerless, so a slug that's
// already claimed (by this account or, in a genuine collision, someone
// else's) is left untouched rather than reassigned. Requires a valid
// Supabase session — there is no anonymous use of this endpoint, unlike
// every other trip-facing route in this app.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const user = await getUserFromRequest(req)
  if (!user) {
    res.status(401).json({ error: 'Sign-in required' })
    return
  }

  const { slugs } = req.body ?? {}
  if (!Array.isArray(slugs) || slugs.length === 0 || !slugs.every((s) => typeof s === 'string')) {
    res.status(400).json({ error: "Missing 'slugs' array of strings in request body" })
    return
  }

  const supabase = getSupabase()
  if (!supabase) {
    res.status(503).json({ error: 'Trip data is temporarily unavailable — please try again in a moment' })
    return
  }

  const { data, error } = await supabase
    .from('itineraries')
    .update({ owner: user.id })
    .in('slug', slugs)
    .is('owner', null)
    .select('slug')

  if (error) {
    console.error('claim-trips error:', error.message)
    res.status(502).json({ error: 'Failed to claim trips' })
    return
  }

  res.status(200).json({ claimed: data.map((row) => row.slug) })
}
