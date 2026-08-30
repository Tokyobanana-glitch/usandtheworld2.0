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
  const [editing, setEditing] = useState(false)
  const [editedItinerary, setEditedItinerary] = useState(null)
  const [addStopDrafts, setAddStopDrafts] = useState({})
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState(null)

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

  function handleStartEdit() {
    setEditedItinerary(structuredClone(current.payload.itinerary))
    setAddStopDrafts({})
    setEditError(null)
    setEditing(true)
  }

  function handleCancelEdit() {
    const changed = JSON.stringify(editedItinerary) !== JSON.stringify(current.payload.itinerary)
    if (changed && !window.confirm('Discard your changes to this trip?')) return
    setEditing(false)
    setEditedItinerary(null)
    setEditError(null)
  }

  function removeStop(dayIdx, stopIdx) {
    setEditedItinerary((prev) =>
      prev.map((day, i) => (i === dayIdx ? { ...day, stops: day.stops.filter((_, si) => si !== stopIdx) } : day)),
    )
  }

  function moveStop(dayIdx, stopIdx, direction) {
    setEditedItinerary((prev) => {
      const stops = prev[dayIdx].stops
      const targetIdx = stopIdx + direction
      if (targetIdx < 0 || targetIdx >= stops.length) return prev
      const nextStops = [...stops]
      ;[nextStops[stopIdx], nextStops[targetIdx]] = [nextStops[targetIdx], nextStops[stopIdx]]
      return prev.map((day, i) => (i === dayIdx ? { ...day, stops: nextStops } : day))
    })
  }

  function moveStopToDay(dayIdx, stopIdx, targetDayIdx) {
    if (targetDayIdx === dayIdx) return
    setEditedItinerary((prev) => {
      const stop = prev[dayIdx].stops[stopIdx]
      return prev.map((day, i) => {
        if (i === dayIdx) return { ...day, stops: day.stops.filter((_, si) => si !== stopIdx) }
        if (i === targetDayIdx) return { ...day, stops: [...day.stops, stop] }
        return day
      })
    })
  }

  function updateTravelerNote(dayIdx, stopIdx, value) {
    setEditedItinerary((prev) =>
      prev.map((day, i) =>
        i === dayIdx
          ? { ...day, stops: day.stops.map((s, si) => (si === stopIdx ? { ...s, travelerNote: value } : s)) }
          : day,
      ),
    )
  }

  function updateAddStopDraft(dayIdx, field, value) {
    setAddStopDrafts((prev) => ({ ...prev, [dayIdx]: { ...prev[dayIdx], [field]: value } }))
  }

  function addStop(dayIdx) {
    const draft = addStopDrafts[dayIdx] || { name: '', city: '' }
    const name = draft.name?.trim()
    const city = draft.city?.trim()
    if (!name || !city) return
    setEditedItinerary((prev) =>
      prev.map((day, i) => (i === dayIdx ? { ...day, stops: [...day.stops, { name, city }] } : day)),
    )
    setAddStopDrafts((prev) => ({ ...prev, [dayIdx]: { name: '', city: '' } }))
  }

  async function handleSaveEdit() {
    setEditSaving(true)
    setEditError(null)
    try {
      const res = await fetch('/api/trip-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: current.slug, itinerary: editedItinerary }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Failed to save your edits.')
      window.location.href = `/trip/${body.newSlug}`
    } catch (err) {
      setEditError(err.message || 'Something went wrong saving your edits.')
      setEditSaving(false)
    }
  }

  const totalChanges = diff ? diff.statusChanged.length + diff.removed.length + diff.added.length : 0

  return (
    <main className="trip-page">
      <div className="trip-page-header">
        <div className="trip-page-header-links">
          <a href="/" className="trip-page-home-link">
            ← Us and The World
          </a>
          <a href="/explore" className="trip-page-home-link">
            Explore trips
          </a>
        </div>
        <div className="trip-page-header-actions">
          {!editing && (
            <button type="button" className="trip-copy-link" onClick={handleStartEdit}>
              Edit this trip
            </button>
          )}
          <button type="button" className="trip-copy-link" onClick={handleCopyLink}>
            {copied ? 'Link copied' : 'Copy link'}
          </button>
        </div>
      </div>

      <p className="trip-verified-note">Verified on {formatDate(current.verifiedAt)}</p>

      {/* Once a re-verify has run, the diff changelog below already states the
          fresh check result — showing the "may be out of date" prompt on top
          of it would be a stale claim about a page that just proved it isn't. */}
      {current.isStale && !diff && !editing && (
        <div className="trip-stale-banner">
          <p>This plan may be out of date. Some places may have changed since it was last checked.</p>
          <button type="button" className="trip-check-changes-btn" onClick={handleReverify} disabled={reverifying}>
            {reverifying ? 'Checking…' : 'Check for changes'}
          </button>
          {reverifyError && <p className="result-error">{reverifyError}</p>}
        </div>
      )}

      {current.newerSlug && !diff && !editing && (
        <a className="trip-newer-link" href={`/trip/${current.newerSlug}`}>
          {current.newerRevisionKind === 'edit'
            ? 'An edited version of this trip exists →'
            : 'A newer verified version of this trip exists →'}
        </a>
      )}

      {editing && (
        <div className="trip-edit-banner">
          <p>Saving creates a new link. The original stays exactly as shared.</p>
        </div>
      )}

      <TurnAnswer result={current.payload} verifiedAt={current.verifiedAt} hideItinerary={editing} />

      {editing && (
        <EditableItinerary
          itinerary={editedItinerary}
          addStopDrafts={addStopDrafts}
          onRemoveStop={removeStop}
          onMoveStop={moveStop}
          onMoveStopToDay={moveStopToDay}
          onNoteChange={updateTravelerNote}
          onAddStopDraftChange={updateAddStopDraft}
          onAddStop={addStop}
        />
      )}

      {editing && (
        <div className="trip-edit-actions">
          <button type="button" className="trip-edit-save-btn" onClick={handleSaveEdit} disabled={editSaving}>
            {editSaving ? 'Saving…' : 'Save as new trip'}
          </button>
          <button type="button" className="trip-edit-cancel-btn" onClick={handleCancelEdit} disabled={editSaving}>
            Cancel
          </button>
          {editError && <p className="result-error">{editError}</p>}
        </div>
      )}

      {!editing && (
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
      )}

      {!editing && (
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
      )}
    </main>
  )
}

// Read/write counterpart to ItineraryDay/StopCard (App.jsx) — those stay
// pure display components; this is the only place stops get reordered,
// removed, reassigned, or annotated. Deliberately doesn't reuse enrichment
// output like legs or travel-time chips while editing — those are
// recomputed server-side on save (see api/trip-edit.js) and would just be
// stale mid-edit.
function EditableItinerary({
  itinerary,
  addStopDrafts,
  onRemoveStop,
  onMoveStop,
  onMoveStopToDay,
  onNoteChange,
  onAddStopDraftChange,
  onAddStop,
}) {
  return (
    <div className="result-section result-section--hero">
      <h3>Itinerary</h3>
      {itinerary.map((day, dayIdx) => (
        <div className="itinerary-day trip-edit-day" key={dayIdx}>
          <h4>
            Day {day.day}: {day.title}
          </h4>
          <div className="stop-list">
            {day.stops.map((stop, stopIdx) => (
              <div className="stop-card trip-edit-stop" key={stopIdx}>
                <div className="stop-card-header">
                  <span className="stop-name">{stop.name}</span>
                  <span className="stop-chip">{stop.city}</span>
                </div>
                {stop.why && <p className="stop-why">{stop.why}</p>}
                <label className="trip-edit-note-label">
                  Your note
                  <textarea
                    className="trip-edit-note-input"
                    rows={2}
                    placeholder="Add a personal note for this stop"
                    value={stop.travelerNote || ''}
                    onChange={(e) => onNoteChange(dayIdx, stopIdx, e.target.value)}
                  />
                </label>
                <div className="trip-edit-stop-actions">
                  <button type="button" onClick={() => onMoveStop(dayIdx, stopIdx, -1)} disabled={stopIdx === 0}>
                    Move up
                  </button>
                  <button
                    type="button"
                    onClick={() => onMoveStop(dayIdx, stopIdx, 1)}
                    disabled={stopIdx === day.stops.length - 1}
                  >
                    Move down
                  </button>
                  {itinerary.length > 1 && (
                    <select
                      value={dayIdx}
                      onChange={(e) => onMoveStopToDay(dayIdx, stopIdx, Number(e.target.value))}
                      aria-label={`Move ${stop.name} to another day`}
                    >
                      {itinerary.map((d, i) => (
                        <option key={i} value={i}>
                          Day {d.day}
                        </option>
                      ))}
                    </select>
                  )}
                  <button type="button" className="trip-edit-remove-btn" onClick={() => onRemoveStop(dayIdx, stopIdx)}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
            {day.stops.length === 0 && <p className="trip-edit-empty-day">No stops on this day.</p>}
          </div>

          <div className="trip-edit-add-stop">
            <input
              type="text"
              placeholder="Place name"
              value={addStopDrafts[dayIdx]?.name || ''}
              onChange={(e) => onAddStopDraftChange(dayIdx, 'name', e.target.value)}
            />
            <input
              type="text"
              placeholder="City"
              value={addStopDrafts[dayIdx]?.city || ''}
              onChange={(e) => onAddStopDraftChange(dayIdx, 'city', e.target.value)}
            />
            <button type="button" onClick={() => onAddStop(dayIdx)}>
              Add a stop
            </button>
          </div>
          <p className="trip-edit-add-stop-hint">We'll try to locate this when you save — it may not resolve.</p>
        </div>
      ))}
    </div>
  )
}
