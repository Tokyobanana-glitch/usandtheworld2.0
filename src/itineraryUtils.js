// Shared by App.jsx (live chat thread) and TripPage.jsx (standalone saved
// trip) — both render the same itinerary shape and need the same derived
// numbers, computed from real stop/leg data, never hardcoded.

export function flattenAllStops(itinerary) {
  const stops = []
  ;(itinerary || []).forEach((day) => (day.stops || []).forEach((s) => stops.push(s)))
  return stops
}

const ATTENTION_LABELS = { closed: 'closed', seasonal: 'seasonal', 'exterior-only': 'exterior-view only', unverified: 'unverified' }

// "X stops checked against live sources on {date}" — derived from the actual
// stops in this itinerary, not a claim about the product in general.
export function computeVerificationSummary(itinerary) {
  const stops = flattenAllStops(itinerary)
  const needsAttention = stops.filter((s) => s.status !== 'open')
  const breakdown = {}
  needsAttention.forEach((s) => {
    const key = s.status || 'unverified'
    breakdown[key] = (breakdown[key] || 0) + 1
  })
  return { total: stops.length, needsAttentionCount: needsAttention.length, breakdown }
}

export function formatBreakdown(breakdown) {
  return Object.entries(breakdown)
    .map(([key, count]) => `${count} ${ATTENTION_LABELS[key] || key}`)
    .join(', ')
}

function parsePrice(str) {
  if (!str) return null
  const trimmed = str.trim()
  if (/^free$/i.test(trimmed)) return { symbol: null, amount: 0, isFree: true }
  // Currency can lead ("€8", "$15") or trail the number ("500 THB", "200
  // THB") — both are common depending on the country, so check both sides
  // rather than assume a prefix.
  const prefixMatch = trimmed.match(/^([€$£¥]|[A-Z]{2,3}\s?)?\s*([\d.,]+)/)
  const suffixMatch = trimmed.match(/^([\d.,]+)\s*([A-Z]{2,3})\b/)
  const m = prefixMatch?.[1] ? prefixMatch : suffixMatch || prefixMatch
  if (!m) return null
  const [, symbolOrAmount, amountOrSymbol] = m
  const isSuffix = m === suffixMatch
  const rawAmount = isSuffix ? symbolOrAmount : amountOrSymbol
  const rawSymbol = isSuffix ? amountOrSymbol : symbolOrAmount
  const amount = parseFloat(String(rawAmount).replace(/,/g, ''))
  if (Number.isNaN(amount)) return null
  return { symbol: rawSymbol ? rawSymbol.trim() : null, isSuffix, amount, isFree: false }
}

// Only sums a total when every priced stop shares one currency symbol — a
// mixed-currency day shows a count instead of a number that looks precise
// but isn't.
export function computeDaySummary(day) {
  const stops = day.stops || []
  const legs = day.legs || []
  const walkingMinutes = legs.filter((l) => l.mode === 'walking').reduce((sum, l) => sum + l.durationMinutes, 0)
  const drivingMinutes = legs.filter((l) => l.mode === 'driving').reduce((sum, l) => sum + l.durationMinutes, 0)

  const parsedPrices = stops.map((s) => parsePrice(s.priceIndicator)).filter(Boolean)
  // null means "no symbol detected" (e.g. a price range the regex couldn't
  // fully parse), not "a different currency" — only compare the symbols we
  // actually found so one undetected symbol doesn't falsely look like a
  // second currency and drop an otherwise-summable total.
  const nonFreeSymbols = new Set(parsedPrices.filter((p) => !p.isFree && p.symbol).map((p) => p.symbol))

  let totalCost = null
  if (parsedPrices.length > 0 && nonFreeSymbols.size <= 1) {
    const priced = parsedPrices.find((p) => !p.isFree && p.symbol) ?? parsedPrices.find((p) => !p.isFree)
    totalCost = {
      symbol: [...nonFreeSymbols][0] ?? null,
      isSuffix: priced?.isSuffix ?? false,
      amount: parsedPrices.reduce((sum, p) => sum + p.amount, 0),
    }
  }

  return { stopCount: stops.length, walkingMinutes, drivingMinutes, priceCount: parsedPrices.length, totalCost }
}

export function formatCheckDate(iso) {
  const d = iso ? new Date(iso) : new Date()
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
