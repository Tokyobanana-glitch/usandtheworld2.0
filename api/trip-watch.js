import { randomBytes } from 'crypto'
import { getSupabase } from './_lib/supabase.js'
import { getItineraryBySlug } from './_lib/itineraryStore.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const { slug, email } = req.body ?? {}
  if (!slug || typeof slug !== 'string') {
    res.status(400).json({ error: "Missing 'slug' string in request body" })
    return
  }
  const trimmedEmail = typeof email === 'string' ? email.trim().toLowerCase() : ''
  if (!EMAIL_RE.test(trimmedEmail)) {
    res.status(400).json({ error: 'Enter a valid email address' })
    return
  }

  const tripResult = await getItineraryBySlug(slug)
  if (tripResult.status === 'not-found') {
    res.status(404).json({ error: 'Trip not found' })
    return
  }
  if (tripResult.status === 'error') {
    res.status(503).json({ error: 'Watching is temporarily unavailable — please try again' })
    return
  }

  const supabase = getSupabase()
  if (!supabase) {
    res.status(503).json({ error: 'Watching is temporarily unavailable' })
    return
  }

  const unsubscribeToken = randomBytes(24).toString('hex')
  // Re-subscribing an already-watching email rotates its unsubscribe token
  // (invalidating any old unsubscribe link for it) and clears
  // unsubscribed_at, so someone who unsubscribed can watch again later.
  const { error } = await supabase
    .from('trip_watch')
    .upsert(
      { slug, email: trimmedEmail, unsubscribe_token: unsubscribeToken, unsubscribed_at: null },
      { onConflict: 'slug,email' },
    )

  if (error) {
    console.error('trip_watch insert error', error.message)
    res.status(502).json({ error: 'Failed to save — please try again' })
    return
  }

  res.status(200).json({ watching: true })
}
