import { getItineraryBySlug, findNewerVersion, CACHE_FRESHNESS_DAYS } from './_lib/itineraryStore.js'

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

function notFoundHtml() {
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" /><title>Trip not found — Us and The World</title>
<meta name="description" content="This trip link may have expired or never existed." /></head>
<body><h1>Trip not found</h1><p>This link may have expired or never existed.</p><a href="/">Search for a new trip</a></body></html>`
}

// Deliberately distinct from notFoundHtml() — a paused database and a
// genuinely missing slug are different failures and must not look the same
// to a viewer. Telling someone their link "may have expired or never
// existed" when the trip actually exists and the database is just
// temporarily unreachable (e.g. a paused free-tier Supabase project) is a
// misleading error message, not a graceful one.
function unavailableHtml() {
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" /><title>Trip temporarily unavailable — Us and The World</title>
<meta name="description" content="We're having trouble loading this trip right now. Please try again in a moment." /></head>
<body><h1>This trip is temporarily unavailable</h1><p>We're having trouble reaching our database right now — this isn't a problem with the link itself. Please try again in a moment.</p><a href="/">Back to search</a></body></html>`
}

// Deliberately minimal: no SSR framework, no React rendering on the server.
// This function fetches the real built index.html from this same deployment
// (so it never has to guess Vite's hashed asset filenames), injects proper
// OG/meta tags and the trip payload, and lets the normal client bundle
// hydrate and render the actual page — the same pattern the app already
// uses everywhere else, just with a different starting data source.
export default async function handler(req, res) {
  const slug = req.query.slug
  if (!slug || typeof slug !== 'string') {
    res.status(400).send('Missing slug')
    return
  }

  const result = await getItineraryBySlug(slug)

  if (result.status === 'not-found') {
    res.status(404).setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(notFoundHtml())
    return
  }
  if (result.status === 'error') {
    res.status(503).setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(unavailableHtml())
    return
  }

  const trip = result.trip
  const newer = await findNewerVersion(slug)
  const ageMs = Date.now() - new Date(trip.verified_at).getTime()
  const isStale = ageMs > CACHE_FRESHNESS_DAYS * 24 * 60 * 60 * 1000

  const destination = trip.payload.destination || 'A trip'
  const description = (trip.payload.answer || '').slice(0, 200)
  const title = `${destination} Itinerary — Us and The World`
  const protocol = req.headers['x-forwarded-proto'] || 'https'
  const origin = `${protocol}://${req.headers.host}`
  const url = `${origin}/trip/${slug}`

  let shell
  try {
    const shellRes = await fetch(`${origin}/index.html`)
    shell = await shellRes.text()
  } catch (err) {
    console.error('trip-page: failed to fetch app shell', err)
    res.status(502).send('Failed to load app shell')
    return
  }

  const tripData = {
    slug: trip.slug,
    query: trip.query,
    payload: trip.payload,
    verifiedAt: trip.verified_at,
    createdAt: trip.created_at,
    isStale,
    freshnessDays: CACHE_FRESHNESS_DAYS,
    newerSlug: newer?.slug ?? null,
    newerRevisionKind: newer?.revision_kind ?? null,
  }

  // Generated fresh per-slug rather than reusing the static earth-hero.jpg
  // directly — a link with the destination name baked into the image itself
  // is what actually earns a click in a crowded social feed; a generic hero
  // shot with no text doesn't tell anyone what they're clicking on.
  const ogImageUrl = `${origin}/api/trip-og?slug=${encodeURIComponent(slug)}`

  const injected = `
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(url)}" />
    <meta property="og:image" content="${escapeHtml(ogImageUrl)}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(ogImageUrl)}" />
    <script>window.__TRIP_DATA__ = ${JSON.stringify(tripData).replace(/</g, '\\u003c')};</script>
  </head>`

  // index.html's description meta tag spans multiple lines (attributes on
  // their own lines) — [^>]* matches across those newlines fine, but the tag
  // name and attribute aren't adjacent text, so the pattern has to allow
  // anything between "<meta" and "name=" too.
  const html = shell
    .replace(/<title>.*?<\/title>/i, '')
    .replace(/<meta[^>]*name="description"[^>]*\/?>/i, '')
    .replace('</head>', injected)

  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.status(200).send(html)
}
