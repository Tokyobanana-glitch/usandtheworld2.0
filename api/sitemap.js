import { listExploreTrips } from './_lib/itineraryStore.js'

function escapeXml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c])
}

// Reuses the exact same set /explore shows — a URL search engines can crawl
// but no human ever sees isn't worth listing, and the two staying in sync
// automatically (same source function) avoids the two silently drifting.
export default async function handler(req, res) {
  const trips = await listExploreTrips()
  const protocol = req.headers['x-forwarded-proto'] || 'https'
  const origin = `${protocol}://${req.headers.host}`

  const staticUrls = [
    { loc: origin, changefreq: 'daily', priority: '1.0' },
    { loc: `${origin}/explore`, changefreq: 'daily', priority: '0.8' },
  ]
  const tripUrls = trips.map((t) => ({
    loc: `${origin}/trip/${t.slug}`,
    lastmod: t.verifiedAt.slice(0, 10),
    changefreq: 'weekly',
    priority: '0.6',
  }))

  const entries = [...staticUrls, ...tripUrls]
    .map(
      (e) => `  <url>
    <loc>${escapeXml(e.loc)}</loc>${e.lastmod ? `\n    <lastmod>${e.lastmod}</lastmod>` : ''}
    <changefreq>${e.changefreq}</changefreq>
    <priority>${e.priority}</priority>
  </url>`,
    )
    .join('\n')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>`

  res.setHeader('Content-Type', 'application/xml; charset=utf-8')
  res.status(200).send(xml)
}
