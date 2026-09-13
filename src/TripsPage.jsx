import { useEffect, useState } from 'react'
import { getRecentTrips, removeRecentTrip } from './services/recentTrips'

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

// Full-page counterpart to the compact <RecentTrips> widget shown on the
// Discover landing — same localStorage-backed source (no accounts yet, see
// services/recentTrips.js), just given a whole tab instead of a sidebar
// strip. Only ever reached via the Trips tab (client-routed), never
// server-rendered, so a plain client fetch-on-mount is enough.
export default function TripsPage() {
  const [trips, setTrips] = useState([])

  useEffect(() => {
    setTrips(getRecentTrips())
  }, [])

  function handleRemove(slug) {
    removeRecentTrip(slug)
    setTrips(getRecentTrips())
  }

  return (
    <main className="trips-page">
      <div className="explore-header">
        <h1>Your trips</h1>
        <p className="explore-subtitle">Saved on this device — trips you've searched or opened show up here.</p>
      </div>

      {trips.length === 0 ? (
        <p className="explore-empty">
          No saved trips yet — <a href="/">search for a destination</a> to start one.
        </p>
      ) : (
        <div className="trips-page-list">
          {trips.map((t) => (
            <div key={t.slug} className="trips-page-item">
              <a href={`/trip/${t.slug}`} className="trips-page-link">
                <span className="trips-page-destination">{t.destination}</span>
                <span className="trips-page-date">Saved {formatDate(t.addedAt)}</span>
              </a>
              <button
                type="button"
                className="trips-page-remove"
                onClick={() => handleRemove(t.slug)}
                aria-label={`Remove ${t.destination} from your trips`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </main>
  )
}
