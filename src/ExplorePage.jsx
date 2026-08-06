function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

// Deliberately a plain list, not the chat UI — this page exists to be
// crawled and linked into from search, where a scannable index beats a
// conversational interface.
export default function ExplorePage({ data }) {
  const trips = data?.trips || []

  return (
    <main className="explore-page">
      <div className="explore-header">
        <a href="/" className="trip-page-home-link">
          ← Us and The World
        </a>
        <h1>Explore verified trips</h1>
        <p className="explore-subtitle">Real day-by-day itineraries, checked against live sources — not generic AI guesses.</p>
      </div>

      {trips.length === 0 ? (
        <p className="explore-empty">No verified trips yet — search for a destination on the homepage to start one.</p>
      ) : (
        <div className="explore-grid">
          {trips.map((trip) => (
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
      )}
    </main>
  )
}
