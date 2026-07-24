import { useEffect, useRef, useState } from 'react'
import { askTravelAssistant } from './services/travelAssistant'
import './App.css'

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

function TurnAnswer({ result }) {
  return (
    <div className="result-details">
      <h2>{result.destination}</h2>
      <p className="result-answer">{result.answer}</p>

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

      {result.itinerary?.length > 0 && (
        <div className="result-section">
          <h3>Itinerary</h3>
          {result.itinerary.map((day) => (
            <div key={day.day} className="itinerary-day">
              <h4>
                Day {day.day}: {day.title}
              </h4>
              <ul>
                {day.activities.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          ))}
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
  const [thread, setThread] = useState([]) // { id, query, status, result?, message? }
  const [submitting, setSubmitting] = useState(false)
  const threadEndRef = useRef(null)

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [thread])

  async function handleSearch(event) {
    event.preventDefault()
    const q = query.trim()
    if (!q || submitting) return

    const id = `${Date.now()}-${Math.random()}`
    const priorTurns = thread.filter((t) => t.status === 'done')

    setSubmitting(true)
    setQuery('')
    setThread((prev) => [...prev, { id, query: q, status: 'loading' }])

    const history = priorTurns.flatMap((t) => [
      { role: 'user', content: t.query },
      { role: 'assistant', content: `${t.result.destination}: ${t.result.answer}` },
    ])

    try {
      const result = await askTravelAssistant(q, { history })
      setThread((prev) => prev.map((t) => (t.id === id ? { ...t, status: 'done', result } : t)))
    } catch (error) {
      setThread((prev) =>
        prev.map((t) => (t.id === id ? { ...t, status: 'error', message: error.message || 'Something went wrong.' } : t)),
      )
    } finally {
      setSubmitting(false)
    }
  }

  function clearQuery() {
    setQuery('')
  }

  function resetConversation() {
    setThread([])
    setQuery('')
  }

  return (
    <main className="hero-page">
      <div className="earth-bg" aria-hidden="true">
        <img src="/earth-hero.jpg" alt="" className="earth-img" />
      </div>

      <div className="hero-content">
        <form className="search-bar" onSubmit={handleSearch} role="search">
          <span className="search-icon">
            <SearchIcon />
          </span>
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={thread.length ? 'Ask a follow-up…' : 'Where do you want to go?'}
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
          <p className="tagline">Discover your next adventure and share it with Usandtheworld.</p>
        )}

        {thread.length > 0 && (
          <div className="result-card" role="status">
            {thread.map((turn) => (
              <div key={turn.id} className="thread-turn">
                <p className="turn-question">You asked — {turn.query}</p>
                {turn.status === 'loading' && <p className="result-loading">Searching the world&hellip;</p>}
                {turn.status === 'error' && <p className="result-error">{turn.message}</p>}
                {turn.status === 'done' && turn.result && <TurnAnswer result={turn.result} />}
              </div>
            ))}
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
