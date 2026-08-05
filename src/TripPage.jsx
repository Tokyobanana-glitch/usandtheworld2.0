import { useEffect, useState } from 'react'
import { TurnAnswer } from './App'
import { addRecentTrip } from './services/recentTrips'

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

function pluralize(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
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
  const [watchEmail, setWatchEmail] = useState('')
  const [watchStatus, setWatchStatus] = useState('idle') // idle | saving | done | error
  const [watchError, setWatchError] = useState(null)

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

  async function handleWatchSubmit(event) {
    event.preventDefault()
    setWatchStatus('saving')
    setWatchError(null)
    try {
      const res = await fetch('/api/trip-watch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: current.slug, email: watchEmail }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Something went wrong')
      setWatchStatus('done')
    } catch (err) {
      setWatchStatus('error')
      setWatchError(err.message || 'Something went wrong — please try again.')
    }
  }

  const totalChanges = diff ? diff.statusChanged.length + diff.removed.length + diff.added.length : 0

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

      <p className="trip-verified-note">Verified on {formatDate(current.verifiedAt)}</p>

      {/* Once a re-verify has run, the diff changelog below already states the
          fresh check result — showing the "may be out of date" prompt on top
          of it would be a stale claim about a page that just proved it isn't. */}
      {current.isStale && !diff && (
        <div className="trip-stale-banner">
          <p>This plan may be out of date. Some places may have changed since it was last checked.</p>
          <button type="button" className="trip-check-changes-btn" onClick={handleReverify} disabled={reverifying}>
            {reverifying ? 'Checking…' : 'Check for changes'}
          </button>
          {reverifyError && <p className="result-error">{reverifyError}</p>}
        </div>
      )}

      {current.newerSlug && !diff && (
        <a className="trip-newer-link" href={`/trip/${current.newerSlug}`}>
          A newer verified version of this trip exists →
        </a>
      )}

      <TurnAnswer result={current.payload} verifiedAt={current.verifiedAt} />

      <div className="trip-reverify-block">
        {diff ? (
          <div className="trip-diff">
            <p className="trip-diff-summary">
              {diff.hasChanges
                ? `Re-checked today — ${pluralize(totalChanges, 'change')} found among ${pluralize(diff.checkedCount, 'stop')}.`
                : `Re-checked today — all ${pluralize(diff.checkedCount, 'stop')} still current.`}
            </p>

            {diff.removed.length > 0 && (
              <div className="trip-diff-group trip-diff-group--prominent">
                <h4>No longer in the itinerary</h4>
                <ul>
                  {diff.removed.map((r, i) => (
                    <li key={i}>
                      {r.name} ({r.city}) — was {r.oldStatus}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {diff.statusChanged.length > 0 && (
              <div className="trip-diff-group trip-diff-group--prominent">
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

            {diff.added.length > 0 && (
              <div className="trip-diff-group trip-diff-group--prominent">
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

            {diff.unchanged.length > 0 && (
              <details className="trip-diff-group trip-diff-group--quiet">
                <summary>{pluralize(diff.unchanged.length, 'stop')} unchanged</summary>
                <ul>
                  {diff.unchanged.map((u, i) => (
                    <li key={i}>
                      {u.name} ({u.city}) — still {u.status}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {current.newerSlug && (
              <a className="trip-newer-link" href={`/trip/${current.newerSlug}`}>
                View the re-verified trip →
              </a>
            )}
          </div>
        ) : (
          !current.isStale && (
            <>
              <button type="button" className="trip-reverify-quiet-btn" onClick={handleReverify} disabled={reverifying}>
                {reverifying ? 'Checking…' : 'Check for changes anyway'}
              </button>
              {reverifyError && <p className="result-error">{reverifyError}</p>}
            </>
          )
        )}
      </div>

      <div className="trip-watch-block">
        {watchStatus === 'done' ? (
          <p className="trip-watch-confirmation">We'll email you if anything on this trip changes.</p>
        ) : (
          <form className="trip-watch-form" onSubmit={handleWatchSubmit}>
            <label htmlFor="trip-watch-email" className="trip-watch-label">
              Get notified if a place on this trip closes or changes
            </label>
            <div className="trip-watch-row">
              <input
                id="trip-watch-email"
                type="email"
                required
                placeholder="you@email.com"
                value={watchEmail}
                onChange={(event) => setWatchEmail(event.target.value)}
              />
              <button type="submit" disabled={watchStatus === 'saving'}>
                {watchStatus === 'saving' ? 'Saving…' : 'Notify me'}
              </button>
            </div>
            {watchStatus === 'error' && <p className="result-error">{watchError}</p>}
          </form>
        )}
      </div>
    </main>
  )
}
