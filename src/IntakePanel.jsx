import { useState } from 'react'
import { getIntakePreferences, saveIntakePreferences, clearIntakePreferences } from './services/intakePreferences'

const DAY_OPTIONS = Array.from({ length: 14 }, (_, i) => i + 1)

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const TRAVELER_OPTIONS = [
  { value: 'solo', label: 'Solo', compose: 'solo' },
  { value: 'couple', label: 'Couple', compose: 'couple' },
  { value: 'family', label: 'Family with kids', compose: 'family with kids' },
  { value: 'group', label: 'Group of friends', compose: 'group of friends' },
]

const PACE_OPTIONS = [
  { value: 'packed', label: 'Packed' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'relaxed', label: 'Relaxed' },
]

const INTEREST_OPTIONS = [
  { value: 'food', label: 'Food & drink', compose: 'food and drink' },
  { value: 'history', label: 'History & architecture', compose: 'history and architecture' },
  { value: 'art', label: 'Art & museums', compose: 'art and museums' },
  { value: 'nature', label: 'Nature & outdoors', compose: 'nature and outdoors' },
  { value: 'nightlife', label: 'Nightlife', compose: 'nightlife' },
  { value: 'shopping', label: 'Shopping', compose: 'shopping' },
  { value: 'offbeat', label: 'Off the beaten path', compose: 'off-the-beaten-path spots' },
]

function joinNaturally(items) {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

// Builds the final query STRING (never a separate params object) — see
// itineraryStore.js: the cache keys on normalized_query, so trip context
// that lived outside the query text would let two very different trips to
// the same city collide on one cached row. Only fields actually filled make
// it in; nothing renders as "not specified" filler.
function composeIntakeQuery({ baseQuery, topic, days, month, budgetAmount, budgetCurrency, budgetPeriod, travelers, pace, interests, notes }) {
  const dayPhrase = `${days} day${days === 1 ? '' : 's'}`
  let lead = topic ? `${dayPhrase} in ${topic}` : `${baseQuery}, ${dayPhrase}`
  if (month && month !== 'not-sure') lead += ` in ${month}`

  const segments = [lead]

  const travelerOpt = TRAVELER_OPTIONS.find((o) => o.value === travelers)
  if (travelerOpt) segments.push(travelerOpt.compose)

  if (pace) segments.push(`${pace} pace`)

  const amount = parseFloat(budgetAmount)
  if (!Number.isNaN(amount) && amount > 0) {
    const currency = budgetCurrency.trim() || '$'
    segments.push(`around ${currency}${amount}${budgetPeriod === 'day' ? '/day' : ' total'}`)
  }

  if (interests.length > 0) {
    const composedInterests = interests.map((v) => INTEREST_OPTIONS.find((o) => o.value === v)?.compose).filter(Boolean)
    if (composedInterests.length) segments.push(`interested in ${joinNaturally(composedInterests)}`)
  }

  if (notes.trim()) segments.push(`note: ${notes.trim()}`)

  return segments.join(', ')
}

// Shown instead of generating immediately whenever a search looks
// destination-style (see extractTopic in App.jsx) or the traveler taps the
// guaranteed "Build me a day-by-day itinerary" CTA. `topic` is the extracted
// destination for a fresh search, or null when reached via that CTA (the
// destination already lives in the conversation history, not this string —
// see App.jsx's handleItineraryCta). One screen, not a wizard: every field
// is optional except days, and "Just build it" skips straight past all of it.
export default function IntakePanel({ baseQuery, topic, onSubmit, onSkip, onCancel }) {
  const persisted = getIntakePreferences() || {}
  const [days, setDays] = useState(3)
  const [month, setMonth] = useState(persisted.month || '')
  const [budgetAmount, setBudgetAmount] = useState(persisted.budgetAmount || '')
  const [budgetCurrency, setBudgetCurrency] = useState(persisted.budgetCurrency || '$')
  const [budgetPeriod, setBudgetPeriod] = useState(persisted.budgetPeriod || 'day')
  const [travelers, setTravelers] = useState(persisted.travelers || '')
  const [pace, setPace] = useState(persisted.pace || '')
  const [interests, setInterests] = useState(persisted.interests || [])
  const [notes, setNotes] = useState(persisted.notes || '')

  function toggleInterest(value) {
    setInterests((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]))
  }

  function handleSubmit(event) {
    event.preventDefault()
    const composed = composeIntakeQuery({ baseQuery, topic, days, month, budgetAmount, budgetCurrency, budgetPeriod, travelers, pace, interests, notes })
    saveIntakePreferences({ month, budgetAmount, budgetCurrency, budgetPeriod, travelers, pace, interests, notes })
    onSubmit(composed)
  }

  function handleClearPrefs() {
    clearIntakePreferences()
    setMonth('')
    setBudgetAmount('')
    setBudgetCurrency('$')
    setBudgetPeriod('day')
    setTravelers('')
    setPace('')
    setInterests([])
    setNotes('')
  }

  return (
    <div className="intake-overlay" role="dialog" aria-modal="true" aria-label="Trip details">
      <div className="intake-panel">
        <div className="intake-panel-header">
          <h2>Tell us about this trip</h2>
          <button type="button" className="intake-close" onClick={onCancel} aria-label="Close">
            ×
          </button>
        </div>

        <form className="intake-panel-body" onSubmit={handleSubmit} id="intake-form">
          <div className="intake-field">
            <span className="intake-field-label">How many days?</span>
            <div className="intake-chip-row">
              {DAY_OPTIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`intake-chip intake-chip--day${days === d ? ' intake-chip--active' : ''}`}
                  onClick={() => setDays(d)}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          <div className="intake-field">
            <label className="intake-field-label" htmlFor="intake-month">
              When are you going?
            </label>
            <select id="intake-month" className="intake-select" value={month} onChange={(event) => setMonth(event.target.value)}>
              <option value="">Select a month…</option>
              <option value="not-sure">Not sure yet</option>
              {MONTHS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div className="intake-field">
            <span className="intake-field-label">Budget</span>
            <div className="intake-budget-row">
              <input
                type="text"
                inputMode="decimal"
                placeholder="Amount"
                value={budgetAmount}
                onChange={(event) => setBudgetAmount(event.target.value.replace(/[^0-9.]/g, ''))}
                className="intake-budget-amount"
                aria-label="Budget amount"
              />
              <input
                type="text"
                value={budgetCurrency}
                onChange={(event) => setBudgetCurrency(event.target.value)}
                className="intake-budget-currency"
                maxLength={3}
                aria-label="Currency"
              />
              <div className="intake-toggle-group" role="group" aria-label="Per day or total">
                <button
                  type="button"
                  className={`intake-toggle${budgetPeriod === 'day' ? ' intake-toggle--active' : ''}`}
                  onClick={() => setBudgetPeriod('day')}
                >
                  /day
                </button>
                <button
                  type="button"
                  className={`intake-toggle${budgetPeriod === 'total' ? ' intake-toggle--active' : ''}`}
                  onClick={() => setBudgetPeriod('total')}
                >
                  total
                </button>
              </div>
            </div>
          </div>

          <div className="intake-field">
            <span className="intake-field-label">Who's going?</span>
            <div className="intake-chip-row">
              {TRAVELER_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className={`intake-chip${travelers === o.value ? ' intake-chip--active' : ''}`}
                  onClick={() => setTravelers((prev) => (prev === o.value ? '' : o.value))}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div className="intake-field">
            <span className="intake-field-label">Pace</span>
            <div className="intake-chip-row">
              {PACE_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className={`intake-chip${pace === o.value ? ' intake-chip--active' : ''}`}
                  onClick={() => setPace((prev) => (prev === o.value ? '' : o.value))}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div className="intake-field">
            <span className="intake-field-label">Interests</span>
            <div className="intake-chip-row">
              {INTEREST_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className={`intake-chip${interests.includes(o.value) ? ' intake-chip--active' : ''}`}
                  onClick={() => toggleInterest(o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div className="intake-field">
            <label className="intake-field-label" htmlFor="intake-notes">
              Anything we should know?
            </label>
            <input
              id="intake-notes"
              type="text"
              className="intake-notes-input"
              placeholder='e.g. "vegetarian", "bad knee, not much walking", "celebrating an anniversary"'
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={140}
            />
          </div>

          <button type="button" className="intake-clear-prefs" onClick={handleClearPrefs}>
            Clear saved preferences
          </button>
        </form>

        <div className="intake-panel-footer">
          <button type="button" className="intake-skip-btn" onClick={onSkip}>
            Just build it
          </button>
          <button type="submit" form="intake-form" className="intake-submit-btn">
            Build my itinerary
          </button>
        </div>
      </div>
    </div>
  )
}
