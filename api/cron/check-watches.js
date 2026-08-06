import { generateAnswer } from '../_lib/generateAnswer.js'
import { getItineraryBySlug, saveItinerary, CACHE_FRESHNESS_DAYS } from '../_lib/itineraryStore.js'
import { diffItineraries } from '../_lib/itineraryDiff.js'
import { getSupabase } from '../_lib/supabase.js'
import { sendTripChangeEmail } from '../_lib/email.js'

// Vercel Cron invokes this with an `Authorization: Bearer $CRON_SECRET`
// header automatically once CRON_SECRET is set as an env var — this check
// is what stops anyone else from hitting a public endpoint that triggers
// paid model calls and sends email on demand.
function isAuthorized(req) {
  if (!process.env.CRON_SECRET) return true // not yet configured — see deploy notes
  return req.headers['authorization'] === `Bearer ${process.env.CRON_SECRET}`
}

export default async function handler(req, res) {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const supabase = getSupabase()
  if (!supabase) {
    res.status(200).json({ checked: 0, note: 'Supabase not configured' })
    return
  }

  const { data: watchers, error } = await supabase.from('trip_watch').select('slug, email, unsubscribe_token').is('unsubscribed_at', null)
  if (error) {
    console.error('check-watches: failed to read trip_watch', error.message)
    res.status(502).json({ error: 'Failed to read watchers' })
    return
  }

  const bySlug = new Map()
  ;(watchers || []).forEach((w) => {
    if (!bySlug.has(w.slug)) bySlug.set(w.slug, [])
    bySlug.get(w.slug).push(w)
  })

  const cutoffMs = Date.now() - CACHE_FRESHNESS_DAYS * 24 * 60 * 60 * 1000
  const protocol = req.headers['x-forwarded-proto'] || 'https'
  const origin = `${protocol}://${req.headers.host}`

  let checkedCount = 0
  let emailedCount = 0

  for (const [slug, rows] of bySlug) {
    const result = await getItineraryBySlug(slug)
    if (result.status !== 'ok') continue

    const trip = result.trip
    // Only re-verify once it's past the same freshness window the manual
    // "Check for changes" button uses — no point paying for a re-verify (and
    // risking an email) on a trip that was just checked.
    if (new Date(trip.verified_at).getTime() > cutoffMs) continue

    checkedCount++
    let fresh
    try {
      fresh = await generateAnswer(trip.query, [], { reverifyItinerary: trip.payload.itinerary })
    } catch (err) {
      console.error(`check-watches: re-verify failed for ${slug}:`, err)
      continue
    }

    const diff = diffItineraries(trip.payload, fresh)
    if (!diff.hasChanges) continue

    const newSlug = await saveItinerary({ query: trip.query, payload: fresh, sourceSlug: slug })
    if (!newSlug) continue

    for (const watcher of rows) {
      await sendTripChangeEmail({
        to: watcher.email,
        destination: trip.payload.destination,
        url: `${origin}/trip/${newSlug}`,
        unsubscribeUrl: `${origin}/api/trip-unwatch?token=${watcher.unsubscribe_token}`,
        diff,
      })
      emailedCount++
    }
  }

  res.status(200).json({ watchedTrips: bySlug.size, checked: checkedCount, emailed: emailedCount })
}
