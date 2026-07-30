import { useEffect, useState } from 'react'
import { getRecentTrips, removeRecentTrip } from './services/recentTrips'

export default function RecentTrips() {
  const [trips, setTrips] = useState([])

  useEffect(() => {
    setTrips(getRecentTrips())
  }, [])

  if (trips.length === 0) return null

  function handleRemove(slug) {
    removeRecentTrip(slug)
    setTrips(getRecentTrips())
  }

  return (
    <div className="recent-trips">
      <h3>Your recent trips</h3>
      <div className="recent-trips-list">
        {trips.map((t) => (
          <div key={t.slug} className="recent-trip-item">
            <a href={`/trip/${t.slug}`} className="recent-trip-link">
              <span className="recent-trip-destination">{t.destination}</span>
              <span className="recent-trip-date">{new Date(t.addedAt).toLocaleDateString()}</span>
            </a>
            <button
              type="button"
              className="recent-trip-remove"
              onClick={() => handleRemove(t.slug)}
              aria-label={`Remove ${t.destination} from recent trips`}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
