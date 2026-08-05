import { getSupabase } from './_lib/supabase.js'

function page(body) {
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8" /><title>Us and The World</title></head>
<body style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 80px auto; padding: 0 20px; color: #111;">
${body}
<p><a href="/">Back to Us and The World</a></p>
</body></html>`
}

// GET, not POST — this is a one-click link inside an email, which has to
// work with a plain click and no JS. The token is single-purpose (only ever
// used from trip_watch) and long/random, so a GET here isn't a CSRF risk in
// the way a state-changing GET normally would be.
export default async function handler(req, res) {
  const token = req.query.token
  if (!token || typeof token !== 'string') {
    res.status(400).setHeader('Content-Type', 'text/html; charset=utf-8').send(page('<p>Missing unsubscribe link.</p>'))
    return
  }

  const supabase = getSupabase()
  if (!supabase) {
    res.status(503).setHeader('Content-Type', 'text/html; charset=utf-8').send(page('<p>Unsubscribing is temporarily unavailable — please try again shortly.</p>'))
    return
  }

  const { error } = await supabase.from('trip_watch').update({ unsubscribed_at: new Date().toISOString() }).eq('unsubscribe_token', token)
  if (error) {
    console.error('trip-unwatch error', error.message)
    res.status(502).setHeader('Content-Type', 'text/html; charset=utf-8').send(page('<p>Something went wrong unsubscribing — please try again.</p>'))
    return
  }

  res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8').send(page("<p>You've been unsubscribed from updates for this trip.</p>"))
}
