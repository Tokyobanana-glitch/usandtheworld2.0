import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from './AuthContext'
import { getSupabaseClient } from './services/supabaseClient'
import { downscaleImage } from './utils/downscaleImage'
import { illustrationUrl } from './curatedMedia'
import PageHeader from './components/PageHeader'
import EmptyState from './components/EmptyState'
import Image from './components/Image'
import './PassportPage.css'

const SIGNED_URL_TTL_SECONDS = 300 // short-lived on purpose — the bucket is private; a link that lasts is a link that can leak

function formatDate(isoDate) {
  if (!isoDate) return null
  // isoDate is a plain YYYY-MM-DD from Postgres `date` — parse as local, not
  // UTC-midnight-then-shifted-a-day-back by the browser's own timezone.
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

// The "most recent" stamp for the hero card and the book's own ordering is
// by when the trip actually happened, not when the row was saved — falls
// back to created_at only for an entry with no visited_on yet, so a freshly
// logged trip with an unset date still sorts somewhere sane.
function entryDateKey(entry) {
  return entry.visited_on || entry.created_at
}

function sortByRecency(entries) {
  return [...entries].sort((a, b) => new Date(entryDateKey(b)) - new Date(entryDateKey(a)))
}

async function signPhotoUrls(paths) {
  if (paths.length === 0) return {}
  const supabase = getSupabaseClient()
  if (!supabase) return {}
  const { data, error } = await supabase.storage.from('passport-photos').createSignedUrls(paths, SIGNED_URL_TTL_SECONDS)
  if (error) {
    console.error('passport photo sign error:', error)
    return {}
  }
  const map = {}
  ;(data ?? []).forEach((d) => {
    if (d.signedUrl && d.path) map[d.path] = d.signedUrl
  })
  return map
}

function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <ellipse cx="12" cy="12" rx="3.6" ry="8.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <line x1="3.5" y1="12" x2="20.5" y2="12" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

function CityIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <rect x="4" y="9" width="6" height="11" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect x="13" y="4" width="7" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <line x1="6.3" y1="12" x2="6.3" y2="12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="15.3" y1="7.5" x2="15.3" y2="7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="15.3" y1="11" x2="15.3" y2="11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M4 8.5h3l1.4-2h7.2l1.4 2h3v11H4z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="12" cy="14" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="currentColor" />
      <circle cx="12" cy="9" r="2.4" fill="var(--color-page-bg)" />
    </svg>
  )
}

// Reads and writes passport_entries / passport_photos directly through the
// authed browser client — same RLS-scoped pattern as Bucket List (see
// BucketListPage.jsx and supabase/004_auth_bucket_passport.sql). Photo
// bytes go straight to Storage from the browser too (upload/remove/sign all
// respect the storage.objects RLS policies keyed on the <user_id> folder
// prefix), never through a server endpoint — only place resolution
// (api/trip-edit.js's 'geocode-place' mode — see geocodePlace below) is
// server-side, and that's stateless.
export default function PassportPage() {
  const { user, loading: authLoading, requestSignIn } = useAuth()

  if (authLoading) return <main className="passport-page" />

  if (!user) {
    return (
      <main className="passport-page">
        <PageHeader variant="large" title="Passport" />
        <div className="passport-body">
          <EmptyState
            illustrationSrc={illustrationUrl('passport')}
            title="Sign in to start your passport"
            description="It's saved to your account, so it travels with you across devices."
            ctaLabel="Sign in"
            onCtaClick={requestSignIn}
            card
          />
        </div>
      </main>
    )
  }

  return <SignedInPassport userId={user.id} />
}

function SignedInPassport({ userId }) {
  const [view, setView] = useState('home') // 'home' | 'form' | 'detail'
  const [bookLayout, setBookLayout] = useState('book') // 'book' | 'grid' — "View all" toggle, home view only
  const [entries, setEntries] = useState([])
  const [photosByEntry, setPhotosByEntry] = useState({})
  const [loading, setLoading] = useState(true)
  const [selectedEntryId, setSelectedEntryId] = useState(null)

  const loadAll = useCallback(async () => {
    const supabase = getSupabaseClient()
    if (!supabase) {
      setLoading(false)
      return
    }
    setLoading(true)
    const { data: entryRows, error } = await supabase
      .from('passport_entries')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) {
      console.error('passport_entries load error:', error)
      setLoading(false)
      return
    }
    const loadedEntries = entryRows ?? []
    setEntries(loadedEntries)

    if (loadedEntries.length === 0) {
      setPhotosByEntry({})
      setLoading(false)
      return
    }

    const { data: photoRows, error: photoError } = await supabase
      .from('passport_photos')
      .select('*')
      .in('entry_id', loadedEntries.map((e) => e.id))
      .order('created_at', { ascending: true })
    if (photoError) console.error('passport_photos load error:', photoError)

    const grouped = {}
    ;(photoRows ?? []).forEach((p) => {
      if (!grouped[p.entry_id]) grouped[p.entry_id] = []
      grouped[p.entry_id].push({ ...p, url: null })
    })

    // Only the cover (first) photo per entry is worth signing up front — the
    // stat tiles' photo count reads array length regardless of signed state,
    // so it's accurate immediately; the rest sign lazily when an entry is
    // actually opened (see openEntry).
    const coverPaths = loadedEntries.map((e) => grouped[e.id]?.[0]?.storage_path).filter(Boolean)
    const urlMap = await signPhotoUrls(coverPaths)
    Object.keys(grouped).forEach((entryId) => {
      grouped[entryId] = grouped[entryId].map((p, i) => (i === 0 ? { ...p, url: urlMap[p.storage_path] ?? null } : p))
    })

    setPhotosByEntry(grouped)
    setLoading(false)
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  async function openEntry(entry) {
    setSelectedEntryId(entry.id)
    setView('detail')
    const photos = photosByEntry[entry.id] || []
    const missing = photos.filter((p) => !p.url)
    if (missing.length === 0) return
    const urlMap = await signPhotoUrls(missing.map((p) => p.storage_path))
    setPhotosByEntry((prev) => ({
      ...prev,
      [entry.id]: (prev[entry.id] || []).map((p) => (p.url ? p : { ...p, url: urlMap[p.storage_path] ?? null })),
    }))
  }

  async function handleCreated(entry, photos) {
    setEntries((prev) => [entry, ...prev])
    setView('home')
    if (photos.length === 0) {
      setPhotosByEntry((prev) => ({ ...prev, [entry.id]: [] }))
      return
    }
    // Sign the cover (first) photo right away — otherwise the book shows a
    // placeholder for a stamp that was just created with a photo, until the
    // next full reload picks it up (see loadAll).
    const urlMap = await signPhotoUrls([photos[0].storage_path])
    setPhotosByEntry((prev) => ({
      ...prev,
      [entry.id]: photos.map((p, i) => (i === 0 ? { ...p, url: urlMap[p.storage_path] ?? null } : { ...p, url: null })),
    }))
  }

  function handleUpdated(updatedEntry) {
    setEntries((prev) => prev.map((e) => (e.id === updatedEntry.id ? updatedEntry : e)))
  }

  async function handlePhotoAdded(entryId, photo) {
    setPhotosByEntry((prev) => ({ ...prev, [entryId]: [...(prev[entryId] || []), { ...photo, url: null }] }))
    const urlMap = await signPhotoUrls([photo.storage_path])
    const url = urlMap[photo.storage_path]
    if (!url) return
    setPhotosByEntry((prev) => ({
      ...prev,
      [entryId]: (prev[entryId] || []).map((p) => (p.id === photo.id ? { ...p, url } : p)),
    }))
  }

  async function handlePhotoRemoved(entryId, photo) {
    const supabase = getSupabaseClient()
    if (!supabase) return
    const { error: storageError } = await supabase.storage.from('passport-photos').remove([photo.storage_path])
    if (storageError) console.error('passport photo storage remove error:', storageError)
    const { error } = await supabase.from('passport_photos').delete().eq('id', photo.id)
    if (error) {
      console.error('passport_photos delete error:', error)
      return
    }
    setPhotosByEntry((prev) => ({ ...prev, [entryId]: (prev[entryId] || []).filter((p) => p.id !== photo.id) }))
  }

  async function handleDelete(entry) {
    if (!window.confirm(`Delete this stamp for "${entry.place_name}"? Its photos will be deleted too.`)) return
    const supabase = getSupabaseClient()
    if (!supabase) return
    const photos = photosByEntry[entry.id] || []
    if (photos.length > 0) {
      const { error: storageError } = await supabase.storage.from('passport-photos').remove(photos.map((p) => p.storage_path))
      // A photo already dangling in Storage is a lesser problem than losing
      // the ability to delete the entry at all — proceed either way, the DB
      // rows are the source of truth for what the user still sees.
      if (storageError) console.error('passport photo storage remove error:', storageError)
    }
    const { error } = await supabase.from('passport_entries').delete().eq('id', entry.id)
    if (error) {
      console.error('passport_entries delete error:', error)
      return
    }
    setEntries((prev) => prev.filter((e) => e.id !== entry.id))
    setPhotosByEntry((prev) => {
      const next = { ...prev }
      delete next[entry.id]
      return next
    })
    setView('home')
    setSelectedEntryId(null)
  }

  const sortedEntries = useMemo(() => sortByRecency(entries), [entries])

  const stats = useMemo(() => {
    const countries = new Set(entries.map((e) => e.country?.trim()).filter(Boolean))
    const cities = new Set(entries.map((e) => e.city?.trim()).filter(Boolean))
    const photos = Object.values(photosByEntry).reduce((sum, arr) => sum + arr.length, 0)
    return { countries: countries.size, cities: cities.size, photos }
  }, [entries, photosByEntry])

  if (view === 'form') {
    return <PassportEntryForm userId={userId} onCancel={() => setView('home')} onCreated={handleCreated} />
  }

  if (view === 'detail') {
    const entry = entries.find((e) => e.id === selectedEntryId)
    if (!entry) {
      setView('home')
      return null
    }
    return (
      <PassportDetail
        entry={entry}
        photos={photosByEntry[entry.id] || []}
        userId={userId}
        onBack={() => setView('home')}
        onUpdated={handleUpdated}
        onDelete={() => handleDelete(entry)}
        onPhotoAdded={(photo) => handlePhotoAdded(entry.id, photo)}
        onPhotoRemoved={(photo) => handlePhotoRemoved(entry.id, photo)}
      />
    )
  }

  return (
    <main className="passport-page">
      <PageHeader variant="large" title="Passport" />

      {loading ? (
        <p className="explore-empty passport-loading">Loading your passport…</p>
      ) : entries.length === 0 ? (
        <div className="passport-body">
          <EmptyState
            illustrationSrc={illustrationUrl('passport')}
            title="Your passport is empty"
            description="Every place you actually visit becomes a page in your travel story."
            ctaLabel="Add your first stamp"
            onCtaClick={() => setView('form')}
            card
          />
        </div>
      ) : (
        <div className="passport-body">
          <div className="passport-toolbar">
            <button type="button" className="passport-link-btn" onClick={() => setView('form')}>
              + Add a stamp
            </button>
          </div>

          <div className="passport-stats">
            <StatTile icon={<GlobeIcon />} label="Countries" value={stats.countries} />
            <StatTile icon={<CityIcon />} label="Cities" value={stats.cities} />
            <StatTile icon={<CameraIcon />} label="Photos" value={stats.photos} />
          </div>

          <PassportHeroCard entry={sortedEntries[0]} cover={photosByEntry[sortedEntries[0].id]?.[0]} onOpen={() => openEntry(sortedEntries[0])} />

          <div className="passport-book-section">
            <div className="passport-section-header">
              <div>
                <h3 className="explore-section-heading">Your stamps</h3>
                <p className="explore-section-subtitle">Swipe through your travels.</p>
              </div>
              <button type="button" className="passport-link-btn" onClick={() => setBookLayout(bookLayout === 'book' ? 'grid' : 'book')}>
                {bookLayout === 'book' ? 'View all' : 'Book view'}
              </button>
            </div>

            {bookLayout === 'book' ? (
              <PassportBook entries={sortedEntries} photosByEntry={photosByEntry} onOpen={openEntry} />
            ) : (
              <div className="passport-tile-grid">
                {sortedEntries.map((entry) => (
                  <PassportTile key={entry.id} entry={entry} cover={photosByEntry[entry.id]?.[0]} onClick={() => openEntry(entry)} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  )
}

function StatTile({ icon, label, value }) {
  return (
    <div className="passport-stat-tile">
      <span className="passport-stat-icon">{icon}</span>
      <span className="passport-stat-value">{value}</span>
      <span className="passport-stat-label">{label}</span>
    </div>
  )
}

function PassportHeroCard({ entry, cover, onOpen }) {
  return (
    <button type="button" className="passport-hero-card" onClick={onOpen}>
      <Image src={cover?.url} alt="" aspectRatio="4 / 5" className="passport-hero-card-image" priority />
      <div className="passport-hero-card-scrim" aria-hidden="true" />
      <div className="passport-hero-card-body">
        {entry.city && (
          <span className="passport-hero-card-eyebrow">
            <PinIcon />
            {entry.city}
          </span>
        )}
        <h2 className="passport-hero-card-title">{entry.place_name}</h2>
        {entry.visited_on && <p className="passport-hero-card-date">{formatDate(entry.visited_on)}</p>}
      </div>
    </button>
  )
}

// Horizontal, native-scroll-snap book of stamp pages — one entry per page,
// no JS drives the swipe itself, only the page indicator. IntersectionObserver
// (rather than reading scrollLeft) tracks which page is centered, since it
// stays correct regardless of each page's actual rendered width.
function PassportBook({ entries, photosByEntry, onOpen }) {
  const trackRef = useRef(null)
  const pageRefs = useRef([])
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    const root = trackRef.current
    if (!root) return undefined
    const observer = new IntersectionObserver(
      (observed) => {
        const mostVisible = observed.filter((o) => o.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        if (!mostVisible) return
        const idx = pageRefs.current.indexOf(mostVisible.target)
        if (idx !== -1) setActiveIndex(idx)
      },
      { root, threshold: [0.5, 0.75, 1] },
    )
    pageRefs.current.forEach((el) => el && observer.observe(el))
    return () => observer.disconnect()
  }, [entries])

  return (
    <div className="passport-book">
      <div className="passport-book-track" ref={trackRef}>
        {entries.map((entry, i) => (
          <PassportBookPage
            key={entry.id}
            ref={(el) => {
              pageRefs.current[i] = el
            }}
            entry={entry}
            cover={photosByEntry[entry.id]?.[0]}
            rotate={i % 2 === 0 ? -6 : 5}
            onOpen={() => onOpen(entry)}
          />
        ))}
      </div>
      {entries.length > 1 && (
        <p className="passport-book-indicator">
          {activeIndex + 1} of {entries.length}
        </p>
      )}
    </div>
  )
}

function PassportBookPage({ entry, cover, rotate, onOpen, ref }) {
  return (
    <button type="button" className="passport-book-page" ref={ref} onClick={onOpen}>
      <div className="passport-book-page-media">
        <Image src={cover?.url} alt="" aspectRatio="4 / 3" className="passport-book-page-image" />
        <StampMark entry={entry} rotate={rotate} />
      </div>
      {entry.note && <p className="passport-book-page-note">{entry.note}</p>}
    </button>
  )
}

// The "inked, bordered, slightly rotated" stamp mark from
// design-reference/DESIGN_REFERENCE.md's Passport section — a passport
// stamp look built from the design tokens (accent color, no new palette),
// not a literal ink-red graphic.
function StampMark({ entry, rotate }) {
  return (
    <div className="passport-stamp-mark" style={{ transform: `rotate(${rotate}deg)` }} aria-hidden="true">
      <span className="passport-stamp-mark-place">{entry.place_name}</span>
      {entry.country && <span className="passport-stamp-mark-country">{entry.country}</span>}
      {entry.visited_on && <span className="passport-stamp-mark-date">{formatDate(entry.visited_on)}</span>}
    </div>
  )
}

function PassportTile({ entry, cover, onClick }) {
  return (
    <button type="button" className="passport-tile" onClick={onClick}>
      <Image src={cover?.url} alt="" aspectRatio="1" className="passport-tile-image" />
      <span className="passport-tile-name">{entry.place_name}</span>
      {entry.visited_on && <span className="passport-tile-date">{formatDate(entry.visited_on)}</span>}
    </button>
  )
}

async function geocodePlace(name, city) {
  try {
    const res = await fetch('/api/trip-edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'geocode-place', name, city }),
    })
    if (!res.ok) return { lat: null, lng: null }
    const data = await res.json()
    return { lat: data.lat ?? null, lng: data.lng ?? null }
  } catch (err) {
    console.error('geocode-place request failed:', err)
    return { lat: null, lng: null }
  }
}

// onStatus(index, status) — indexed, not keyed by the File object itself:
// callers update a React status array by position, and doing that lookup
// inside a setState updater (as an earlier version of this did) runs afoul
// of StrictMode double-invoking updaters to catch exactly this kind of
// impurity.
async function uploadPhotos(entryId, files, userId, onStatus) {
  const supabase = getSupabaseClient()
  if (!supabase) return []
  const uploaded = []
  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    onStatus(i, 'downscaling')
    let toUpload = file
    try {
      toUpload = await downscaleImage(file)
    } catch (err) {
      console.error('downscaleImage failed, uploading original:', err)
    }

    onStatus(i, 'uploading')
    const path = `${userId}/${crypto.randomUUID()}.jpg`
    const { error: uploadError } = await supabase.storage.from('passport-photos').upload(path, toUpload, { contentType: 'image/jpeg' })
    if (uploadError) {
      console.error('passport photo upload error:', uploadError)
      onStatus(i, 'error')
      continue
    }

    const { data: photoRow, error: insertError } = await supabase
      .from('passport_photos')
      .insert({ entry_id: entryId, storage_path: path })
      .select()
      .single()
    if (insertError) {
      console.error('passport_photos insert error:', insertError)
      onStatus(i, 'error')
      continue
    }

    onStatus(i, 'done')
    uploaded.push(photoRow)
  }
  return uploaded
}

function PhotoPicker({ files, onFilesChange, statuses }) {
  return (
    <div className="passport-photo-picker">
      <label className="passport-photo-picker-label">
        <input
          type="file"
          accept="image/*"
          multiple
          onChange={(event) => onFilesChange([...event.target.files])}
          className="passport-photo-input"
        />
        + Add photos
      </label>
      {files.length > 0 && (
        <ul className="passport-upload-queue">
          {files.map((file, i) => (
            <li key={`${file.name}-${i}`} className="passport-upload-queue-item">
              <span className="passport-upload-queue-name">{file.name}</span>
              <span className="passport-upload-queue-status">{statuses[i] || 'queued'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function PassportEntryForm({ userId, onCancel, onCreated }) {
  const [placeName, setPlaceName] = useState('')
  const [city, setCity] = useState('')
  const [country, setCountry] = useState('')
  const [visitedOn, setVisitedOn] = useState('')
  const [note, setNote] = useState('')
  const [files, setFiles] = useState([])
  const [statuses, setStatuses] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  function handleFilesChange(newFiles) {
    setFiles(newFiles)
    setStatuses(new Array(newFiles.length).fill('queued'))
  }

  function handleStatus(index, status) {
    setStatuses((prev) => {
      const next = [...prev]
      next[index] = status
      return next
    })
  }

  async function handleSubmit(event) {
    event.preventDefault()
    const name = placeName.trim()
    if (!name) return
    setSaving(true)
    setError(null)

    const { lat, lng } = await geocodePlace(name, city.trim())

    const supabase = getSupabaseClient()
    if (!supabase) {
      setSaving(false)
      setError('Passport is temporarily unavailable — please try again.')
      return
    }
    const { data: entry, error: insertError } = await supabase
      .from('passport_entries')
      .insert({
        owner: userId,
        place_name: name,
        city: city.trim() || null,
        country: country.trim() || null,
        lat,
        lng,
        visited_on: visitedOn || null,
        note: note.trim() || null,
      })
      .select()
      .single()

    if (insertError) {
      console.error('passport_entries insert error:', insertError)
      setSaving(false)
      setError('Could not save this stamp — please try again.')
      return
    }

    const photos = files.length > 0 ? await uploadPhotos(entry.id, files, userId, handleStatus) : []
    setSaving(false)
    onCreated(entry, photos)
  }

  return (
    <main className="passport-page">
      <div className="passport-form-header">
        <button type="button" className="bucket-list-back" onClick={onCancel}>
          ← Passport
        </button>
        <h1 className="passport-form-title">Add a stamp</h1>
      </div>

      <form className="passport-form" onSubmit={handleSubmit}>
        <input
          type="text"
          className="intake-notes-input"
          placeholder="Place — e.g. Fushimi Inari Shrine"
          value={placeName}
          onChange={(event) => setPlaceName(event.target.value)}
        />
        <input
          type="text"
          className="intake-notes-input"
          placeholder="City — e.g. Kyoto"
          value={city}
          onChange={(event) => setCity(event.target.value)}
        />
        <input
          type="text"
          className="intake-notes-input"
          placeholder="Country — e.g. Japan"
          value={country}
          onChange={(event) => setCountry(event.target.value)}
        />
        <input
          type="date"
          className="intake-notes-input"
          value={visitedOn}
          onChange={(event) => setVisitedOn(event.target.value)}
          max={new Date().toISOString().slice(0, 10)}
        />
        <textarea
          className="passport-note-input"
          placeholder="Notes — what made it worth remembering?"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
        />

        <PhotoPicker files={files} onFilesChange={handleFilesChange} statuses={statuses} />

        {error && <p className="result-error">{error}</p>}

        <button type="submit" className="intake-submit-btn" disabled={saving || !placeName.trim()}>
          {saving ? 'Saving…' : 'Save stamp'}
        </button>
      </form>
    </main>
  )
}

// Shares only text (place, date, note) — never a signed photo URL, per
// design-reference/DESIGN_REFERENCE.md: photos stay private, the signed URLs
// this app hands out are short-lived and scoped to the viewer's own session,
// so sharing one out would either break immediately or (worse) leak a real
// URL that momentarily still works.
function buildShareText(entry) {
  const lines = [entry.place_name]
  if (entry.city) lines.push(entry.country ? `${entry.city}, ${entry.country}` : entry.city)
  if (entry.visited_on) lines.push(formatDate(entry.visited_on))
  if (entry.note) lines.push('', entry.note)
  return lines.join('\n')
}

function PassportDetail({ entry, photos, userId, onBack, onUpdated, onDelete, onPhotoAdded, onPhotoRemoved }) {
  const [visitedOn, setVisitedOn] = useState(entry.visited_on || '')
  const [note, setNote] = useState(entry.note || '')
  const [newFiles, setNewFiles] = useState([])
  const [statuses, setStatuses] = useState([])
  const [uploading, setUploading] = useState(false)
  const [shareStatus, setShareStatus] = useState('idle') // 'idle' | 'copied'

  function handleStatus(index, status) {
    setStatuses((prev) => {
      const next = [...prev]
      next[index] = status
      return next
    })
  }

  async function saveIfChanged() {
    if (visitedOn === (entry.visited_on || '') && note.trim() === (entry.note || '')) return
    const supabase = getSupabaseClient()
    if (!supabase) return
    const { data, error } = await supabase
      .from('passport_entries')
      .update({ visited_on: visitedOn || null, note: note.trim() || null })
      .eq('id', entry.id)
      .select()
      .single()
    if (error) {
      console.error('passport_entries update error:', error)
      return
    }
    onUpdated(data)
  }

  async function handleAddPhotos(files) {
    if (files.length === 0) return
    setNewFiles(files)
    setStatuses(new Array(files.length).fill('queued'))
    setUploading(true)
    const uploaded = await uploadPhotos(entry.id, files, userId, handleStatus)
    uploaded.forEach((photo) => onPhotoAdded(photo))
    setUploading(false)
    setNewFiles([])
    setStatuses([])
  }

  async function handleShare() {
    const text = buildShareText(entry)
    if (navigator.share) {
      try {
        await navigator.share({ title: entry.place_name, text })
      } catch (err) {
        if (err.name !== 'AbortError') console.error('passport share failed:', err)
      }
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      setShareStatus('copied')
      setTimeout(() => setShareStatus('idle'), 2000)
    } catch (err) {
      console.error('passport share clipboard fallback failed:', err)
    }
  }

  return (
    <main className="passport-page">
      <div className="passport-detail-header">
        <button type="button" className="bucket-list-back" onClick={onBack}>
          ← Passport
        </button>
        <div className="bucket-list-detail-title-row">
          <h1>{entry.place_name}</h1>
          <button type="button" className="bucket-list-icon-btn" aria-label={`Delete stamp for ${entry.place_name}`} onClick={onDelete}>
            ×
          </button>
        </div>
        {(entry.city || entry.country) && (
          <p className="explore-subtitle">{[entry.city, entry.country].filter(Boolean).join(', ')}</p>
        )}
        <button type="button" className="passport-share-btn" onClick={handleShare}>
          {shareStatus === 'copied' ? 'Copied to clipboard' : 'Share'}
        </button>
      </div>

      <div className="passport-detail-body">
        {photos.length > 0 && (
          <div className="passport-detail-photos">
            {photos.map((photo) => (
              <div key={photo.id} className="passport-detail-photo">
                {photo.url ? <img src={photo.url} alt="" /> : <div className="passport-photo-placeholder" aria-hidden="true" />}
                <button
                  type="button"
                  className="bucket-list-icon-btn passport-detail-photo-remove"
                  aria-label="Remove photo"
                  onClick={() => onPhotoRemoved(photo)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <PhotoPicker files={newFiles} onFilesChange={handleAddPhotos} statuses={statuses} />
        {uploading && <p className="passport-upload-note">Uploading…</p>}

        <div className="passport-form">
          <label className="intake-field-label" htmlFor="passport-visited-on">
            Visited
          </label>
          <input
            id="passport-visited-on"
            type="date"
            className="intake-notes-input"
            value={visitedOn}
            onChange={(event) => setVisitedOn(event.target.value)}
            onBlur={saveIfChanged}
            max={new Date().toISOString().slice(0, 10)}
          />

          <label className="intake-field-label" htmlFor="passport-note">
            Note
          </label>
          <textarea
            id="passport-note"
            className="passport-note-input"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onBlur={saveIfChanged}
            rows={4}
          />
        </div>
      </div>
    </main>
  )
}
