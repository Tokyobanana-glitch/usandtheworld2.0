import { ImageResponse } from '@vercel/og'
import { getItineraryBySlug } from './_lib/itineraryStore.js'

// Satori (the engine behind ImageResponse) needs real font bytes — it can't
// resolve @font-face/Google Fonts URLs itself. This is the standard
// workaround for using a Google Font outside of next/font: request the
// font CSS with an old-Safari user agent, which makes Google serve back a
// direct .ttf URL instead of .woff2 (Satori wants ttf/otf/woff, not woff2).
async function loadGoogleFont(family, weight) {
  const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}&display=swap`
  const css = await fetch(cssUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_6_8) AppleWebKit/534.57.2 (KHTML, like Gecko) Version/5.1.7 Safari/534.57.2' },
  }).then((r) => r.text())
  const match = css.match(/src: url\(([^)]+)\)/)
  if (!match) throw new Error(`No font src found for ${family} ${weight}`)
  const fontRes = await fetch(match[1])
  return fontRes.arrayBuffer()
}

export default async function handler(req, res) {
  const protocol = req.headers['x-forwarded-proto'] || 'https'
  const origin = `${protocol}://${req.headers.host}`
  const { searchParams } = new URL(req.url, origin)
  const slug = searchParams.get('slug')

  let destination = 'Us and The World'
  let subtitle = 'Discover your next adventure'

  if (slug) {
    const result = await getItineraryBySlug(slug)
    if (result.status === 'ok') {
      const payload = result.trip.payload
      destination = payload.destination || destination
      const dayCount = payload.itinerary?.length || 0
      const stopCount = payload.itinerary?.reduce((sum, d) => sum + (d.stops?.length || 0), 0) || 0
      subtitle = dayCount > 0
        ? `${dayCount}-day itinerary · ${stopCount} verified stop${stopCount === 1 ? '' : 's'}`
        : 'A verified travel plan'
    }
  }

  // Font loading is an enhancement, never a hard dependency — a fetch
  // failure here (offline font CDN, format change) must still produce a
  // valid image with a system fallback rather than a broken 500 on every
  // social unfurl.
  let fonts = []
  try {
    const [regular, bold] = await Promise.all([loadGoogleFont('Playfair Display', 500), loadGoogleFont('Playfair Display', 700)])
    fonts = [
      { name: 'Playfair Display', data: regular, weight: 500, style: 'normal' },
      { name: 'Playfair Display', data: bold, weight: 700, style: 'normal' },
    ]
  } catch (err) {
    console.error('trip-og: font load failed, falling back to system font:', err)
  }

  const image = new ImageResponse(
    (
      <div
        style={{
          width: '1200px',
          height: '630px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          position: 'relative',
          backgroundColor: '#050813',
        }}
      >
        <img
          src={`${origin}/earth-hero.jpg`}
          width={1200}
          height={630}
          style={{ position: 'absolute', top: 0, left: 0, objectFit: 'cover' }}
        />
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '1200px',
            height: '630px',
            display: 'flex',
            background: 'linear-gradient(to top, rgba(5,8,19,0.96) 0%, rgba(5,8,19,0.55) 45%, rgba(5,8,19,0.15) 100%)',
          }}
        />
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', padding: '64px' }}>
          <div style={{ display: 'flex', fontSize: 22, fontWeight: 600, letterSpacing: 2, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase' }}>
            Us and The World
          </div>
          <div
            style={{
              display: 'flex',
              fontFamily: fonts.length ? 'Playfair Display' : 'serif',
              fontWeight: 700,
              fontSize: 76,
              color: '#fff',
              marginTop: 18,
              lineHeight: 1.1,
            }}
          >
            {destination}
          </div>
          <div style={{ display: 'flex', fontSize: 26, color: 'rgba(255,255,255,0.85)', marginTop: 16 }}>{subtitle}</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630, fonts },
  )

  res.statusCode = image.status
  for (const [key, value] of image.headers) {
    res.setHeader(key, value)
  }
  res.end(Buffer.from(await image.arrayBuffer()))
}
