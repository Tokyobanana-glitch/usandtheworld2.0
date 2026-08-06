const WIKIPEDIA_SUMMARY_URL = 'https://en.wikipedia.org/api/rest_v1/page/summary/'

async function fetchSummary(title) {
  const res = await fetch(`${WIKIPEDIA_SUMMARY_URL}${encodeURIComponent(title)}`)
  if (!res.ok) return null
  return res.json()
}

// Pure enrichment on top of the model's answer, same as geocoding and
// creator clips — never something that can break answer generation. Every
// failure path (missing page, disambiguation, network error) returns null
// rather than throwing, so a caller can always safely await this.
export async function getDestinationImage(destination) {
  if (!destination || typeof destination !== 'string') return null

  try {
    let summary = await fetchSummary(destination)

    // "Kyoto, Japan" rarely has its own page — the city usually does. Only
    // retry when the fallback title actually differs, so a plain "Kyoto"
    // doesn't fire the same request twice.
    const fallbackTitle = destination.split(',')[0].trim()
    if ((!summary || summary.type === 'disambiguation') && fallbackTitle && fallbackTitle !== destination) {
      summary = await fetchSummary(fallbackTitle)
    }

    if (!summary || summary.type === 'disambiguation') return null

    const url = summary.originalimage?.source || summary.thumbnail?.source
    const attributionUrl = summary.content_urls?.desktop?.page
    if (!url || !attributionUrl) return null

    return { url, attributionUrl }
  } catch (err) {
    console.error('getDestinationImage failed:', err)
    return null
  }
}
