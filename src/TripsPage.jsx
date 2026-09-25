import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { getSupabaseClient } from './services/supabaseClient'
import { getRecentTrips, removeRecentTrip } from './services/recentTrips'
import { getWatchingTrips, removeWatchingTrip, getSharedTrips, removeSharedTrip } from './services/tripTracking'
import { citySlug, illustrationUrl, resolveDestinationImage } from './curatedMedia'
import PageHeader from './components/PageHeader'
import SegmentedControl from './components/SegmentedControl'
import EmptyState from './components/EmptyState'
import Image from './components/Image'
import './TripsPage.css'

const SEGMENTS = [
  { key: 'planned', label: 'Planned' },
  { key: 'watching', label: 'Watching' },
  { key: 'shared', label: 'Shared with me' },
]

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

// Resolves a card image the same way BucketListCard does for a place with no
// curated slug of its own (see BucketListPage.jsx's useResolvedImage) —
// duplicated rather than shared for the same reason that file gives: this
// page's chunk isn't guaranteed to have that one already loaded.
function useResolvedImage(destination) {
  const [src, setSrc] = useState(null)
  useEffect(() => {
    let cancelled = false
    setSrc(null)
    if (!destination) return undefined
    resolveDestinationImage({ slug: citySlug(destination), kind: 'card', wikipediaTitle: destination }).then((url) => {
      if (!cancelled) setSrc(url)
    })
    return () => {
      cancelled = true
    }
  }, [destination])
  return src
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
      <path d="M12 3.2v11.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" fill="none" />
      <path d="M7.6 7.6L12 3.2l4.4 4.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path
        d="M5 11.5v7a1.3 1.3 0 0 0 1.3 1.3h11.4A1.3 1.3 0 0 0 19 18.5v-7"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
      <path d="M4.5 12.5l5 5 10-11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  )
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
//
// Watching and Shared-with-me are both entirely this-device localStorage
// (see services/tripTracking.js and TripPage.jsx, which is what actually
// writes to them) — there's no account-level query for either, on purpose;
// see that file's header comment for why.
export default function TripsPage() {
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [segment, setSegment] = useState('planned')

  const [planned, setPlanned] = useState([])
  const [plannedLoading, setPlannedLoading] = useState(true)
  const [watching, setWatching] = useState([])
  const [shared, setShared] = useState([])

  useEffect(() => {
    setWatching(getWatchingTrips())
    setShared(getSharedTrips())
  }, [])

  useEffect(() => {
    if (authLoading) return
    let cancelled = false

    async function load() {
      if (!user) {
        if (!cancelled) {
          setPlanned(getRecentTrips().map((t) => ({ ...t, source: 'local' })))
          setPlannedLoading(false)
        }
        return
      }

      setPlannedLoading(true)
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
            dayCount: row.payload?.itinerary?.length ?? null,
            verifiedAt: row.verified_at || row.created_at,
            source: 'remote',
          }))
        }
      }

      const remoteSlugs = new Set(remote.map((t) => t.slug))
      const localOnly = getRecentTrips()
        .filter((t) => !remoteSlugs.has(t.slug))
        .map((t) => ({ ...t, source: 'local' }))

      if (!cancelled) {
        const merged = [...remote, ...localOnly].sort(
          (a, b) => new Date(b.verifiedAt || b.addedAt) - new Date(a.verifiedAt || a.addedAt),
        )
        setPlanned(merged)
        setPlannedLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [user, authLoading])

  function handleRemovePlanned(slug) {
    removeRecentTrip(slug)
    setPlanned((prev) => prev.filter((t) => t.slug !== slug))
  }

  function handleRemoveWatching(slug) {
    removeWatchingTrip(slug)
    setWatching((prev) => prev.filter((t) => t.slug !== slug))
  }

  function handleRemoveShared(slug) {
    removeSharedTrip(slug)
    setShared((prev) => prev.filter((t) => t.slug !== slug))
  }

  function goExplore() {
    navigate('/')
  }

  return (
    <main className="trips-page">
      <PageHeader variant="large" title="Travel" />

      <div className="trips-page-segmented">
        <SegmentedControl segments={SEGMENTS} activeKey={segment} onChange={setSegment} />
      </div>

      {segment === 'planned' && (
        <TripSegment
          loading={plannedLoading}
          trips={planned}
          onRemove={handleRemovePlanned}
          emptyTitle="Your travel calendar is wide open"
          onExplore={goExplore}
        />
      )}
      {segment === 'watching' && (
        <TripSegment
          trips={watching}
          onRemove={handleRemoveWatching}
          emptyTitle="Nothing on watch yet — subscribe to alerts from any trip page"
          onExplore={goExplore}
        />
      )}
      {segment === 'shared' && (
        <TripSegment
          trips={shared}
          onRemove={handleRemoveShared}
          emptyTitle="No trips shared with you yet"
          onExplore={goExplore}
        />
      )}
    </main>
  )
}

function TripSegment({ loading = false, trips, onRemove, emptyTitle, onExplore }) {
  if (loading) {
    return <p className="explore-empty trips-page-loading">Loading your trips…</p>
  }

  if (trips.length === 0) {
    return (
      <EmptyState
        illustrationSrc={illustrationUrl('travel')}
        title={emptyTitle}
        ctaLabel="Find your inspiration"
        ctaVariant="link"
        onCtaClick={onExplore}
      />
    )
  }

  return (
    <div className="trips-page-grid">
      {trips.map((trip) => (
        <TripCard key={trip.slug} trip={trip} onRemove={onRemove} />
      ))}
    </div>
  )
}

function TripCard({ trip, onRemove }) {
  const imageSrc = useResolvedImage(trip.destination)
  const [shareStatus, setShareStatus] = useState('idle') // 'idle' | 'copied'

  async function handleShare() {
    const url = `${window.location.origin}/trip/${trip.slug}`
    if (navigator.share) {
      try {
        await navigator.share({ title: trip.destination, url })
      } catch (err) {
        if (err.name !== 'AbortError') console.error('trip share failed:', err)
      }
      return
    }
    try {
      await navigator.clipboard.writeText(url)
      setShareStatus('copied')
      setTimeout(() => setShareStatus('idle'), 2000)
    } catch (err) {
      console.error('trip share clipboard fallback failed:', err)
    }
  }

  const dateLabel = trip.verifiedAt ? `Verified ${formatDate(trip.verifiedAt)}` : trip.addedAt ? `Saved ${formatDate(trip.addedAt)}` : null

  return (
    <div className="trips-page-card">
      <Link to={`/trip/${trip.slug}`} className="trips-page-card-media">
        <Image src={imageSrc} alt="" aspectRatio="4 / 3" className="trips-page-card-image" />
      </Link>
      <button
        type="button"
        className="trips-page-share-btn"
        aria-label={shareStatus === 'copied' ? 'Link copied' : `Share ${trip.destination}`}
        onClick={handleShare}
      >
        {shareStatus === 'copied' ? <CheckIcon /> : <ShareIcon />}
      </button>
      <div className="trips-page-card-footer">
        <div className="trips-page-card-title-row">
          <Link to={`/trip/${trip.slug}`} className="trips-page-card-name">
            {trip.destination}
          </Link>
          {trip.source === 'local' && (
            <button
              type="button"
              className="bucket-list-icon-btn"
              aria-label={`Remove ${trip.destination}`}
              onClick={() => onRemove(trip.slug)}
            >
              ×
            </button>
          )}
        </div>
        {trip.dayCount ? (
          <span className="trips-page-card-meta">
            {trip.dayCount} day{trip.dayCount === 1 ? '' : 's'}
          </span>
        ) : null}
        {dateLabel && <span className="trips-page-card-meta">{dateLabel}</span>}
      </div>
    </div>
  )
}
