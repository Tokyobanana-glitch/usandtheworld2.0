import { useEffect, useState } from 'react'
import { TurnAnswer } from './App'
import { addRecentTrip } from './services/recentTrips'

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

// Standalone page for a saved trip — deliberately NOT embedded in the chat
// thread. A plan someone will share and edit shouldn't live inside a
// scrolling conversation. Reads window.__TRIP_DATA__, injected server-side
// by api/trip-page.js so share previews (OG tags) work before any JS runs.
export default function TripPage({ data }) {
  const [current, setCurrent] = useState(data)
  const [reverifying, setReverifying] = useState(false)
  const [reverifyError, setReverifyError] = useState(null)
  const [diff, setDiff] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    addRecentTrip({ slug: current.slug, destination: current.payload.destination, query: current.query })
    // Only ever on first mount for this slug — re-verify updates local state,
    // it doesn't navigate here, so this shouldn't re-fire per keystroke etc.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleReverify() {
    setReverifying(true)
    setReverifyError(null)
    try {
      const res = await fetch('/api/trip-reverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: current.slug }),
      })
      if (!res.ok) throw new Error('Re-verify failed — please try again in a moment.')
      const result = await res.json()
      setDiff(result.diff)
      setCurrent((prev) => ({ ...prev, newerSlug: result.newSlug }))
    } catch (err) {
      setReverifyError(err.message || 'Something went wrong re-verifying this trip.')
    } finally {
      setReverifying(false)
    }
  }

  function handleCopyLink() {
    navigator.clipboard?.writeText(window.location.href).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <main className="trip-page">
      <div className="trip-page-header">
        <a href="/" className="trip-page-home-link">
          ← Us and The World
        </a>
        <button type="button" className="trip-copy-link" onClick={handleCopyLink}>
          {copied ? 'Link copied' : 'Copy link'}
        </button>
      </div>

      <p className="trip-verified-note">
        Verified on {formatDate(current.verifiedAt)}
        {current.isStale && (
          <span className="trip-stale-badge">
            {' '}
            — this plan may be out of date. Some places may have changed since it was checked.
          </span>
        )}
      </p>

      {current.newerSlug && (
        <a className="trip-newer-link" href={`/trip/${current.newerSlug}`}>
          A newer verified version of this trip exists →
        </a>
      )}

      <TurnAnswer result={current.payload} />

      <div className="trip-reverify-block">
        <button type="button" onClick={handleReverify} disabled={reverifying}>
          {reverifying ? 'Re-verifying…' : 'Re-verify this trip'}
        </button>
        {reverifyError && <p className="result-error">{reverifyError}</p>}

        {diff && (
          <div className="trip-diff">
            {!diff.hasChanges && <p>No changes since the original check.</p>}

            {diff.statusChanged.length > 0 && (
              <div>
                <h4>Status changed</h4>
                <ul>
                  {diff.statusChanged.map((c, i) => (
                    <li key={i}>
                      {c.name} ({c.city}): {c.oldStatus} → {c.newStatus}
                      {c.newStatusNote ? ` — ${c.newStatusNote}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {diff.removed.length > 0 && (
              <div>
                <h4>No longer in the itinerary</h4>
                <ul>
                  {diff.removed.map((r, i) => (
                    <li key={i}>
                      {r.name} ({r.city})
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {diff.added.length > 0 && (
              <div>
                <h4>New stops</h4>
                <ul>
                  {diff.added.map((a, i) => (
                    <li key={i}>
                      {a.name} ({a.city})
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {current.newerSlug && (
              <a className="trip-newer-link" href={`/trip/${current.newerSlug}`}>
                View the re-verified trip →
              </a>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
