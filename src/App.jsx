import { useEffect, useRef, useState } from 'react'
import { askTravelAssistant } from './services/travelAssistant'
import { addRecentTrip } from './services/recentTrips'
import { computeVerificationSummary, computeDaySummary, formatBreakdown, formatCheckDate } from './itineraryUtils'
import RecentTrips from './RecentTrips'
import './App.css'

const TYPEWRITER_DESTINATIONS = [
  'Barcelona',
  'Miami',
  'Tokyo',
  'Bangkok',
  'Istanbul',
  'Cape Town',
  'Reykjavík',
  'Marrakech',
  'Rio de Janeiro',
  'Bali',
]
const TYPE_MS = 70
const DELETE_MS = 40
const HOLD_MS = 1400
const PAUSE_MS = 400
const LOADING_PHRASE_MS = 2500

const TOPIC_PREFIXES = [
  /^i want to travel to\s+/i,
  /^i want to go to\s+/i,
  /^i'?d like to (go|travel) to\s+/i,
  /^travel(ing)? to\s+/i,
  /^trip to\s+/i,
  /^vacation (to|in)\s+/i,
  /^weekend\s+(trip\s+)?(to|in|at)\s+/i,
  /^visit(ing)?\s+/i,
  /^\d+\s*(day|days|week|weeks)\s+in\s+/i,
  /^(best|top|good|great)\s+.+?\s+(near|in|around|for)\s+/i,
]
const TOPIC_TRAILING_SEASON = /\s+(in|during)\s+(spring|summer|fall|autumn|winter|january|february|march|april|may|june|july|august|september|october|november|december|\d{4}).*$/i
const TOPIC_EXCLUDE_WORDS =
  /\?|burnt|burned|fire|destroy|open|close|food|eat|stay|cost|price|weather|safe|what|when|how|why|there/i

function extractTopic(rawQuery) {
  let q = rawQuery.trim()
  for (const re of TOPIC_PREFIXES) {
    if (re.test(q)) {
      q = q.replace(re, '').trim()
      break
    }
  }
  q = q.replace(TOPIC_TRAILING_SEASON, '').trim()

  if (!q || q.length > 28 || TOPIC_EXCLUDE_WORDS.test(q)) return null
  return q
}

// Loading phrases stay topic-based rather than naming specific stops on
// purpose — see Part E discussion: naming real stop names here would require
// streaming the model's output and incrementally parsing partial structured
// JSON to know what it's working on in real time. That's a genuinely
// different request lifecycle (SSE plumbing, a streaming-tolerant partial-
// JSON parser), not a small addition, and faking specificity with names the
// model isn't actually verifying yet would be a worse lie than a generic
// phrase. Keeping this fallback until that's worth building on its own.
function buildLoadingPhrases(rawQuery) {
  const topic = extractTopic(rawQuery)
  if (topic) {
    return [
      `Searching for the best places to visit around ${topic}…`,
      `Scanning the latest articles and local sources for ${topic}…`,
      `Checking current conditions and openings near ${topic}…`,
      `Cross-referencing real-time results to get ${topic} right…`,
    ]
  }
  return [
    'Searching the web for the most current information…',
    'Scanning the latest articles and local sources…',
    'Checking facts and current conditions…',
    'Cross-referencing real-time results to get this right…',
  ]
}

// A technically-successful response with nothing in it — no answer text, no
// itinerary — is a silent failure this app should never render as if
// everything worked. Seen live: a "done" turn with no visible content at
// all, no error message, nothing to explain it.
function isEmptyResult(result) {
  const hasAnswer = Boolean(result?.answer?.trim())
  const hasItinerary = result?.itinerary?.length > 0
  return !hasAnswer && !hasItinerary
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
      <line x1="21" y1="21" x2="16.2" y2="16.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function ClearIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <line x1="5" y1="5" x2="19" y2="19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="19" y1="5" x2="5" y2="19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

const STATUS_LABELS = { open: 'Open', closed: 'Closed', seasonal: 'Seasonal', 'exterior-only': 'Exterior only', unverified: 'Unverified' }

// A status with no source is shown as unverified regardless of what the
// model claimed — an unsupported claim doesn't get credit for looking
// confident. Only a sourced, non-unverified status becomes a clickable link,
// with the check date visible next to it rather than buried in a tooltip.
export function StatusChip({ status, sourceUrl, verifiedAt }) {
  const hasSource = Boolean(sourceUrl && sourceUrl.trim())
  const key = hasSource && STATUS_LABELS[status] ? status : 'unverified'
  const label = STATUS_LABELS[key]

  if (hasSource && key !== 'unverified') {
    return (
      <a className={`status-chip status-chip--${key}`} href={sourceUrl} target="_blank" rel="noopener noreferrer">
        {label}
        <span className="status-check-date">checked {formatCheckDate(verifiedAt)}</span>
      </a>
    )
  }
  return <span className={`status-chip status-chip--${key}`}>{label}</span>
}

export function LegConnector({ leg }) {
  if (!leg) return null
  const icon = leg.mode === 'walking' ? '🚶' : '🚗'
  const modeLabel = leg.mode === 'walking' ? 'walk' : 'drive'
  return (
    <div className={`leg-connector${leg.longLeg ? ' leg-connector--long' : ''}`}>
      {leg.longLeg && (
        <span className="leg-warning" title="Long transfer">
          ⚠
        </span>
      )}
      <span>
        {icon} {leg.durationMinutes} min {modeLabel}
        {leg.estimated ? ' (est.)' : ''}
      </span>
      <span className="leg-distance">{leg.distanceKm} km</span>
    </div>
  )
}

export function StopCard({ stop, verifiedAt }) {
  return (
    <div className={`stop-card${stop.unlocatable ? ' stop-card--unlocatable' : ''}`}>
      <div className="stop-card-header">
        <span className="stop-name">{stop.name}</span>
        <StatusChip status={stop.status} sourceUrl={stop.sourceUrl} verifiedAt={verifiedAt} />
      </div>
      <div className="stop-meta">
        {stop.category && <span className="stop-chip">{stop.category}</span>}
        {stop.timeOfDay && <span className="stop-chip">{stop.timeOfDay}</span>}
        {stop.durationMinutes ? <span className="stop-chip">~{stop.durationMinutes} min</span> : null}
        {stop.priceIndicator && <span className="stop-chip stop-chip--price">{stop.priceIndicator}</span>}
      </div>
      {stop.why && <p className="stop-why">{stop.why}</p>}
      {stop.statusNote && <p className="stop-status-note">{stop.statusNote}</p>}
      {stop.unlocatable && <p className="stop-unlocatable-note">Location not confirmed — shown without travel time</p>}
    </div>
  )
}

// Handles both itinerary shapes: legacy responses (or anything cached before
// this change) may still have `activities: [string]` instead of `stops:
// [object]` — checked right here via `day.stops` presence, so a mixed-shape
// thread never crashes.
export function ItineraryDay({ day, verifiedAt }) {
  if (!day.stops) {
    return (
      <div className="itinerary-day">
        <h4>
          Day {day.day}: {day.title}
        </h4>
        <ul>
          {(day.activities || []).map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      </div>
    )
  }

  const legByFromIndex = new Map((day.legs || []).map((leg) => [leg.fromIndex, leg]))
  const summary = computeDaySummary(day)

  return (
    <div className="itinerary-day">
      <h4>
        Day {day.day}: {day.title}
      </h4>
      <div className="day-summary-strip">
        <span>{summary.stopCount} stop{summary.stopCount === 1 ? '' : 's'}</span>
        {summary.walkingMinutes > 0 && <span>{summary.walkingMinutes} min walking</span>}
        {summary.drivingMinutes > 0 && <span>{summary.drivingMinutes} min driving</span>}
        {summary.totalCost && (
          <span>
            {summary.totalCost.amount === 0
              ? 'Free'
              : summary.totalCost.isSuffix
                ? `~${Math.round(summary.totalCost.amount * 100) / 100} ${summary.totalCost.symbol || ''}`
                : `~${summary.totalCost.symbol || ''}${Math.round(summary.totalCost.amount * 100) / 100}`}
          </span>
        )}
        {!summary.totalCost && summary.priceCount > 0 && (
          <span>{summary.priceCount} stop{summary.priceCount === 1 ? '' : 's'} with pricing</span>
        )}
      </div>
      <div className="stop-list">
        {day.stops.map((stop, i) => (
          <div key={i}>
            <StopCard stop={stop} verifiedAt={verifiedAt} />
            {legByFromIndex.has(i) && <LegConnector leg={legByFromIndex.get(i)} />}
          </div>
        ))}
      </div>
    </div>
  )
}

const SENTENCE_SPLIT = /[^.!?]+[.!?]+(\s+|$)/g
const TRUNCATE_SENTENCE_LIMIT = 3

// The itinerary is the product — long prose above it pushed the actual plan
// below the fold. Truncated to a few sentences with an explicit expand
// control, rather than hidden entirely.
function TruncatedAnswer({ text }) {
  const [expanded, setExpanded] = useState(false)
  if (!text) return null

  const sentences = text.match(SENTENCE_SPLIT) || [text]
  if (sentences.length <= TRUNCATE_SENTENCE_LIMIT) {
    return <p className="result-answer">{text}</p>
  }

  const truncated = sentences.slice(0, TRUNCATE_SENTENCE_LIMIT).join('').trim()
  return (
    <div className="truncated-answer">
      <p className="result-answer">{expanded ? text : truncated}</p>
      <button type="button" className="truncate-toggle" onClick={() => setExpanded((e) => !e)}>
        {expanded ? 'Show less' : 'Read more'}
      </button>
    </div>
  )
}

// verifiedAt defaults to "now" for a fresh, in-thread answer (it really was
// just checked) — TripPage passes the saved trip's actual verifiedAt instead.
export function TurnAnswer({ result, verifiedAt }) {
  const effectiveVerifiedAt = verifiedAt || new Date().toISOString()
  const hasItinerary = result.itinerary?.length > 0
  const summary = hasItinerary ? computeVerificationSummary(result.itinerary) : null

  return (
    <div className="result-details">
      <h2>{result.destination}</h2>
      <TruncatedAnswer text={result.answer} />

      {result.slug && hasItinerary && (
        <a className="share-trip-link" href={`/trip/${result.slug}`}>
          Share this trip →
        </a>
      )}

      {summary && (
        <p className="verification-receipt">
          {summary.total} stop{summary.total === 1 ? '' : 's'} checked against live sources on{' '}
          {formatCheckDate(effectiveVerifiedAt)}
          {summary.needsAttentionCount === 0
            ? ' — all currently open.'
            : ` — ${summary.needsAttentionCount} need${summary.needsAttentionCount === 1 ? 's' : ''} your attention: ${formatBreakdown(summary.breakdown)}.`}
        </p>
      )}

      {hasItinerary && (
        <div className="result-section result-section--hero">
          <h3>Itinerary</h3>
          {result.itinerary.map((day) => (
            <ItineraryDay key={day.day} day={day} verifiedAt={effectiveVerifiedAt} />
          ))}
        </div>
      )}

      {result.bestTimeToVisit && (
        <p className="result-best-time">
          <strong>Best time to visit:</strong> {result.bestTimeToVisit}
        </p>
      )}

      {result.suggestions?.length > 0 && (
        <div className="result-section">
          <h3>Suggestions</h3>
          <ul>
            {result.suggestions.map((s, i) => (
              <li key={i}>
                <strong>{s.title}</strong> — {s.description}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.sources?.length > 0 && (
        <div className="result-section result-sources">
          <h3>Sources</h3>
          <ul>
            {result.sources.map((src, i) => (
              <li key={i}>
                <a href={src.url} target="_blank" rel="noopener noreferrer">
                  {src.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function App() {
  const [query, setQuery] = useState('')
  const [placeholder, setPlaceholder] = useState('Where do you want to go?')
  const [thread, setThread] = useState([]) // { id, query, status, result?, message? }
  const [submitting, setSubmitting] = useState(false)
  const [loadingPhrases, setLoadingPhrases] = useState([])
  const [loadingPhraseIndex, setLoadingPhraseIndex] = useState(0)
  // Computed once at mount (not in an effect) so the video never flashes in
  // for mobile/reduced-motion visitors who should only ever see the poster.
  const [showHeroVideo] = useState(
    () => !window.matchMedia?.('(max-width: 767px)').matches && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  )
  const threadEndRef = useRef(null)
  const inputRef = useRef(null)
  const queryRef = useRef(query)

  useEffect(() => {
    queryRef.current = query
  }, [query])

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [thread])

  // Typewriter placeholder inviting a first search — only before a conversation starts.
  useEffect(() => {
    if (thread.length > 0) return

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setPlaceholder('Where do you want to go? Try Tokyo, Bali, Rome…')
      return
    }

    let cityIndex = 0
    let charIndex = 0
    let deleting = false
    let timeoutId

    function tick() {
      if (queryRef.current) {
        timeoutId = setTimeout(tick, 300)
        return
      }

      const city = TYPEWRITER_DESTINATIONS[cityIndex % TYPEWRITER_DESTINATIONS.length]

      if (!deleting) {
        charIndex++
        setPlaceholder(`I want to travel to ${city.slice(0, charIndex)}`)
        if (charIndex === city.length) {
          deleting = true
          timeoutId = setTimeout(tick, HOLD_MS)
          return
        }
        timeoutId = setTimeout(tick, TYPE_MS)
      } else {
        charIndex--
        setPlaceholder(`I want to travel to ${city.slice(0, charIndex)}`)
        if (charIndex === 0) {
          deleting = false
          cityIndex++
          timeoutId = setTimeout(tick, PAUSE_MS)
          return
        }
        timeoutId = setTimeout(tick, DELETE_MS)
      }
    }

    timeoutId = setTimeout(tick, PAUSE_MS)
    return () => clearTimeout(timeoutId)
  }, [thread.length])

  // Rotate the loading phrase every few seconds while a search is in flight.
  useEffect(() => {
    if (!submitting) return
    const id = setInterval(() => {
      setLoadingPhraseIndex((i) => (i + 1) % (loadingPhrases.length || 1))
    }, LOADING_PHRASE_MS)
    return () => clearInterval(id)
  }, [submitting, loadingPhrases])

  async function runSearch(rawQuery, { bypassCache = false, retryId = null } = {}) {
    const q = rawQuery.trim()
    if (!q || submitting) return

    const id = retryId ?? `${Date.now()}-${Math.random()}`
    const priorTurns = thread.filter((t) => t.status === 'done')

    setSubmitting(true)
    setQuery('')
    setLoadingPhrases(buildLoadingPhrases(q))
    setLoadingPhraseIndex(0)
    setThread((prev) => (retryId ? prev.map((t) => (t.id === id ? { ...t, status: 'loading' } : t)) : [...prev, { id, query: q, status: 'loading' }]))

    const history = priorTurns.flatMap((t) => [
      { role: 'user', content: t.query },
      { role: 'assistant', content: `${t.result.destination}: ${t.result.answer}` },
    ])

    try {
      const result = await askTravelAssistant(q, { history, bypassCache })
      // A "done" response with no actual content (no answer, no itinerary) is
      // a silent failure — the underlying request technically succeeded but
      // produced nothing worth showing. Surfacing that plainly, with a way
      // to retry that skips the client-side cache, beats rendering a blank
      // result card with no indication anything went wrong.
      if (isEmptyResult(result)) {
        setThread((prev) => prev.map((t) => (t.id === id ? { ...t, status: 'empty' } : t)))
        return
      }
      setThread((prev) => prev.map((t) => (t.id === id ? { ...t, status: 'done', result } : t)))
      if (result.slug) addRecentTrip({ slug: result.slug, destination: result.destination, query: q })
    } catch (error) {
      setThread((prev) =>
        prev.map((t) => (t.id === id ? { ...t, status: 'error', message: error.message || 'Something went wrong.' } : t)),
      )
    } finally {
      setSubmitting(false)
    }
  }

  function retrySearch(turn) {
    runSearch(turn.query, { bypassCache: true, retryId: turn.id })
  }

  function handleSearch(event) {
    event.preventDefault()
    runSearch(query)
  }

  function clearQuery() {
    setQuery('')
  }

  function resetConversation() {
    setThread([])
    setQuery('')
  }

  function focusForNewQuestion() {
    setQuery('')
    inputRef.current?.focus()
  }

  const lastTurn = thread[thread.length - 1]
  const showFollowUps = lastTurn?.status === 'done' && lastTurn.result

  return (
    <main className="hero-page">
      <div className="earth-bg" aria-hidden="true">
        {showHeroVideo ? (
          <video className="earth-media" autoPlay muted loop playsInline preload="auto" poster="/earth-hero.jpg">
            <source src="/earth-hero.mp4" type="video/mp4" />
          </video>
        ) : (
          <img src="/earth-hero.jpg" alt="" className="earth-media" />
        )}
      </div>
      <div className="earth-overlay" aria-hidden="true" />

      <div className="hero-content">
        <form className="search-bar" onSubmit={handleSearch} role="search">
          <span className="search-icon">
            <SearchIcon />
          </span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={thread.length ? 'Ask a follow-up…' : placeholder}
            aria-label="Search a destination or travel question"
            autoComplete="off"
          />
          {query && (
            <button type="button" className="clear-icon" onClick={clearQuery} aria-label="Clear search">
              <ClearIcon />
            </button>
          )}
        </form>

        {thread.length === 0 && (
          <>
            <p className="tagline">Discover your next adventure and share it with Usandtheworld.</p>
            <RecentTrips />
          </>
        )}

        {thread.length > 0 && (
          <div className="result-card" role="status">
            {thread.map((turn) => (
              <div key={turn.id} className="thread-turn">
                <p className="turn-question">You asked — {turn.query}</p>
                {turn.status === 'loading' && (
                  <p className="result-loading" key={loadingPhraseIndex}>
                    {loadingPhrases[loadingPhraseIndex] || 'Searching the world…'}
                  </p>
                )}
                {turn.status === 'error' && <p className="result-error">{turn.message}</p>}
                {turn.status === 'empty' && (
                  <div className="result-empty">
                    <p>That didn't come back with anything — not an error, just an empty answer. Worth trying again.</p>
                    <button type="button" className="result-empty-retry" onClick={() => retrySearch(turn)} disabled={submitting}>
                      Try again
                    </button>
                  </div>
                )}
                {turn.status === 'done' && turn.result && <TurnAnswer result={turn.result} />}
              </div>
            ))}

            {showFollowUps && (
              <div className="followups">
                {lastTurn.result.followUps?.map((text, i) => (
                  <button key={i} type="button" className="followup-chip" onClick={() => runSearch(text)}>
                    {text}
                  </button>
                ))}
                <button type="button" className="followup-chip followup-chip--muted" onClick={focusForNewQuestion}>
                  Ask something else
                </button>
              </div>
            )}

            <div ref={threadEndRef} />

            <button type="button" className="reset-conversation" onClick={resetConversation}>
              Start a new search
            </button>
          </div>
        )}
      </div>
    </main>
  )
}

export default App
