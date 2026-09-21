// Destination imagery resolution: curated first, then a live Wikipedia
// lookup, then nothing (the caller — Image.jsx — renders its dark
// placeholder). None of the curated files exist yet (see CLAUDE.md's
// imagery note), so this must degrade cleanly with zero of them present;
// the Wikipedia tier is what currently makes it look populated at all.
//
// The Wikipedia fetch mirrors api/_lib/destinationImage.js's logic
// (same endpoint, same disambiguation/fallback-title handling) but is its
// own small client-side copy rather than a shared import — that file is
// server-only (never meant to ship to the browser bundle), and duplicating
// ~15 lines here is cheaper than restructuring it to be safely isomorphic.
const WIKIPEDIA_SUMMARY_URL = 'https://en.wikipedia.org/api/rest_v1/page/summary/'

export function curatedHeroUrl(slug) {
  return `/destinations/${slug}-hero.jpg`
}

export function curatedCardUrl(slug) {
  return `/destinations/${slug}-card.jpg`
}

export function illustrationUrl(name) {
  return `/illustrations/${name}-empty.png`
}

async function fetchWikipediaImage(title) {
  try {
    const res = await fetch(`${WIKIPEDIA_SUMMARY_URL}${encodeURIComponent(title)}`)
    if (!res.ok) return null
    const summary = await res.json()
    if (!summary || summary.type === 'disambiguation') return null
    return summary.originalimage?.source || summary.thumbnail?.source || null
  } catch {
    return null
  }
}

// A real network probe, not a HEAD request — Vercel's static file serving
// doesn't reliably support HEAD for this purpose, and a probe image load is
// exactly what the browser would do to display it anyway, so there's no
// extra cost to finding out this way.
function imageExists(url) {
  return new Promise((resolve) => {
    const img = new window.Image()
    img.onload = () => resolve(true)
    img.onerror = () => resolve(false)
    img.src = url
  })
}

// destinationSlug + kind resolve the curated tier; wikipediaTitle (usually
// the plain destination/city name) resolves the fallback tier. Either can
// be omitted to skip straight to the next tier — e.g. a place with no known
// slug yet still gets a Wikipedia photo. Returns null when nothing
// resolved; Image.jsx already renders cleanly with a null/absent src.
export async function resolveDestinationImage({ slug, kind = 'hero', wikipediaTitle } = {}) {
  if (slug) {
    const curated = kind === 'card' ? curatedCardUrl(slug) : curatedHeroUrl(slug)
    if (await imageExists(curated)) return curated
  }
  if (wikipediaTitle) {
    const wiki = await fetchWikipediaImage(wikipediaTitle)
    if (wiki) return wiki
  }
  return null
}
