import { listExploreTrips } from './_lib/itineraryStore.js'

// Same deliberately-minimal pattern as trip-page.js: fetch the real built
// index.html from this deployment, inject data + meta tags, let the normal
// client bundle hydrate. No SSR framework, no guessing Vite's hashed
// filenames.
export default async function handler(req, res) {
  const trips = await listExploreTrips()

  const protocol = req.headers['x-forwarded-proto'] || 'https'
  const origin = `${protocol}://${req.headers.host}`
  const url = `${origin}/explore`
  const title = 'Explore verified trips — Us and The World'
  const description = 'Real, verified day-by-day itineraries for destinations around the world — checked against live sources, not generic AI guesses.'

  let shell
  try {
    const shellRes = await fetch(`${origin}/index.html`)
    shell = await shellRes.text()
  } catch (err) {
    console.error('explore-page: failed to fetch app shell', err)
    res.status(502).send('Failed to load app shell')
    return
  }

  const injected = `
    <title>${title}</title>
    <meta name="description" content="${description}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:url" content="${url}" />
    <script>window.__EXPLORE_DATA__ = ${JSON.stringify({ trips }).replace(/</g, '\\u003c')};</script>
  </head>`

  const html = shell
    .replace(/<title>.*?<\/title>/i, '')
    .replace(/<meta[^>]*name="description"[^>]*\/?>/i, '')
    .replace('</head>', injected)

  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.status(200).send(html)
}
