import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

const PREVIEW_COUNT = 6
const MIN_TO_SHOW = 3

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

// The Discover landing's "below the fold" inspiration layer — real,
// product-generated verified trips (same source as the Explore tab), never
// hand-authored content. Deliberately hides itself entirely below
// MIN_TO_SHOW rather than rendering a thin, obviously-empty-looking grid —
// a near-empty "inspiration" section undercuts the pitch it's making.
export default function DiscoverFeed() {
  const [trips, setTrips] = useState(null) // null = not loaded yet, distinct from an empty list

  useEffect(() => {
    let cancelled = false
    fetch('/api/explore-data')
      .then((res) => res.json())
      .then((body) => {
        if (!cancelled) setTrips(body.trips || [])
      })
      .catch(() => {
        if (!cancelled) setTrips([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!trips || trips.length < MIN_TO_SHOW) return null

  return (
    <section className="discover-feed">
      <div className="discover-feed-inner">
        <h3 className="discover-feed-title">Real trips, verified today</h3>
        <div className="explore-grid">
          {trips.slice(0, PREVIEW_COUNT).map((trip) => (
            <a key={trip.slug} href={`/trip/${trip.slug}`} className="explore-card">
              {trip.destinationImage && <img src={trip.destinationImage.url} alt="" className="explore-card-image" />}
              <span className="explore-card-destination">{trip.destination}</span>
              <span className="explore-card-meta">
                {trip.dayCount} day{trip.dayCount === 1 ? '' : 's'} · {trip.stopCount} stop{trip.stopCount === 1 ? '' : 's'}
              </span>
              <span className="explore-card-date">Verified {formatDate(trip.verifiedAt)}</span>
            </a>
          ))}
        </div>
        <Link to="/explore" className="discover-feed-see-all">
          See all verified trips →
        </Link>
      </div>
    </section>
  )
}
