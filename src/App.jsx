import { useState } from 'react'
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

function App() {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('idle') // idle | loading | done | error
  const [result, setResult] = useState(null)
  const [message, setMessage] = useState('')

  async function handleSearch(event) {
    event.preventDefault()
    const q = query.trim()
    if (!q || status === 'loading') return

    setStatus('loading')
    setResult(null)
    setMessage('')

    try {
      const data = await askTravelAssistant(q)
      setResult(data)
      setStatus('done')
    } catch (error) {
      setMessage(error.message || 'Something went wrong.')
      setStatus('error')
    }
  }

  function clearSearch() {
    setQuery('')
    setResult(null)
    setMessage('')
    setStatus('idle')
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
            placeholder="Where do you want to go?"
            aria-label="Search a destination or travel question"
            autoComplete="off"
          />
          {query && (
            <button
              type="button"
              className="clear-icon"
              onClick={clearSearch}
              aria-label="Clear search"
            >
              <ClearIcon />
            </button>
          )}
        </form>

        <p className="tagline">Discover your next adventure and share it with Usandtheworld.</p>

        {status !== 'idle' && (
          <div className="result-card" role="status">
            {status === 'loading' && <p className="result-loading">Searching the world&hellip;</p>}
            {status === 'error' && <p className="result-error">{message}</p>}

            {status === 'done' && result && (
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
            )}
          </div>
        )}
      </div>
    </main>
  )
}

export default App
