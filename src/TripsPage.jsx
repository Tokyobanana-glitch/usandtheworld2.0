import { useEffect, useState } from 'react'
import { useAuth } from './AuthContext'
import { getSupabaseClient } from './services/supabaseClient'
import { getRecentTrips, removeRecentTrip } from './services/recentTrips'

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

// Signed out: unchanged from before accounts existed — localStorage
// recentTrips only (see services/recentTrips.js), no network call.
//
// Signed in: a trip saved to the account (owner set at generation time, or
// retroactively via claim-trips on sign-in — see accountMigration.js) lives
// in Supabase, not this device's localStorage, so a signed-in user on a new
// device would otherwise see an empty tab despite having trips on their
// account. Reads itineraries directly through the RLS-scoped client (see
// supabase/005_itinerary_owner_select.sql — itineraries had zero SELECT
// policies before this), same as Bucket List/Passport, then merges in any
// local trips NOT already in that remote set — covers the case where a
// trip was searched on this device before migration ran (migration only
// fires on a fresh SIGNED_IN event, not on every session restore) and so
// hasn't been claimed yet. Only genuinely local-only entries get the
// "forget it" remove control; a trip already on the account isn't
// something this tab deletes.
export default function TripsPage() {
  const { user, loading: authLoading } = useAuth()
  const [trips, setTrips] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (authLoading) return
    let cancelled = false

    async function load() {
      if (!user) {
        if (!cancelled) {
          setTrips(getRecentTrips().map((t) => ({ ...t, source: 'local' })))
          setLoading(false)
        }
        return
      }

      setLoading(true)
      let remote = []
      const supabase = getSupabaseClient()
      if (supabase) {
        const { data, error } = await supabase
          .from('itineraries')
          .select('slug, payload, verified_at, created_at')
          .is('revision_kind', null)
          .order('verified_at', { ascending: false })
        if (error) {
          console.error('itineraries load error:', error)
        } else {
          remote = (data ?? []).map((row) => ({
            slug: row.slug,
            destination: row.payload?.destination || row.slug,
            addedAt: row.verified_at || row.created_at,
            source: 'remote',
          }))
        }
      }

      const remoteSlugs = new Set(remote.map((t) => t.slug))
      const localOnly = getRecentTrips()
        .filter((t) => !remoteSlugs.has(t.slug))
        .map((t) => ({ ...t, source: 'local' }))

      if (!cancelled) {
        const merged = [...remote, ...localOnly].sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt))
        setTrips(merged)
        setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [user, authLoading])

  function handleRemove(slug) {
    removeRecentTrip(slug)
    setTrips((prev) => prev.filter((t) => t.slug !== slug))
  }

  return (
    <main className="trips-page">
      <div className="explore-header">
        <h1>Your trips</h1>
        <p className="explore-subtitle">
          {user
            ? 'Trips saved to your account, plus anything searched on this device.'
            : 'Saved on this device — trips you\'ve searched or opened show up here.'}
        </p>
      </div>

      {loading ? (
        <p className="explore-empty">Loading your trips…</p>
      ) : trips.length === 0 ? (
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
              {t.source === 'local' && (
                <button
                  type="button"
                  className="trips-page-remove"
                  onClick={() => handleRemove(t.slug)}
                  aria-label={`Remove ${t.destination} from your trips`}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  )
}
