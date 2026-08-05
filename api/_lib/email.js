import { Resend } from 'resend'

let client = null
function getClient() {
  if (client) return client
  const key = process.env.RESEND_API_KEY
  if (!key) return null
  client = new Resend(key)
  return client
}

const FROM = process.env.TRIP_WATCH_FROM_EMAIL || 'Us and The World <onboarding@resend.dev>'

// Never throws — a failed send shouldn't take down the cron run for every
// other watcher. Missing RESEND_API_KEY degrades to a logged no-op rather
// than an error, so the rest of the app works fine before this is configured.
export async function sendTripChangeEmail({ to, destination, url, unsubscribeUrl, diff }) {
  const resend = getClient()
  if (!resend) {
    console.error('RESEND_API_KEY not set — skipping trip-change email to', to)
    return { skipped: true }
  }

  const changeLines = [
    ...diff.removed.map((r) => `- ${r.name} (${r.city}) is no longer in the plan — was ${r.oldStatus}`),
    ...diff.statusChanged.map((c) => `- ${c.name} (${c.city}): ${c.oldStatus} → ${c.newStatus}`),
    ...diff.added.map((a) => `- New stop added: ${a.name} (${a.city})`),
  ].join('\n')

  const { error } = await resend.emails.send({
    from: FROM,
    to,
    subject: `Something changed on your ${destination} trip`,
    text: `We re-checked your ${destination} itinerary and found some changes:\n\n${changeLines}\n\nView the updated trip: ${url}\n\nStop watching this trip: ${unsubscribeUrl}`,
  })

  if (error) console.error('trip-change email send failed for', to, error)
  return { skipped: false, error }
}
