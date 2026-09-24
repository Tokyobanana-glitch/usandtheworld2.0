import { useCallback, useEffect, useState } from 'react'
import { useAuth } from './AuthContext'
import { getSupabaseClient } from './services/supabaseClient'
import { downscaleImage } from './utils/downscaleImage'
import PageHeader from './components/PageHeader'

const SIGNED_URL_TTL_SECONDS = 300 // short-lived on purpose — the bucket is private; a link that lasts is a link that can leak

function formatDate(isoDate) {
  if (!isoDate) return null
  // isoDate is a plain YYYY-MM-DD from Postgres `date` — parse as local, not
  // UTC-midnight-then-shifted-a-day-back by the browser's own timezone.
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
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
        <div className="explore-header">
          <p className="explore-subtitle">A record of the places you've actually been — a stamp for every stop, with photos and notes.</p>
        </div>
        <div className="tab-auth-pitch">
          <p>Sign in to start your passport. It's saved to your account, so it travels with you across devices.</p>
          <button type="button" className="intake-submit-btn" onClick={requestSignIn}>
            Sign in to get started
          </button>
        </div>
      </main>
    )
  }

  return <SignedInPassport userId={user.id} />
}

function SignedInPassport({ userId }) {
  const [view, setView] = useState('grid') // 'grid' | 'form' | 'detail'
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

    // Only the cover (first) photo per entry is worth signing up front —
    // the rest sign lazily when an entry is actually opened (see openEntry).
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
    setView('grid')
    if (photos.length === 0) {
      setPhotosByEntry((prev) => ({ ...prev, [entry.id]: [] }))
      return
    }
    // Sign the cover (first) photo right away — otherwise the grid shows a
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
    setView('grid')
    setSelectedEntryId(null)
  }

  if (view === 'form') {
    return (
      <PassportEntryForm
        userId={userId}
        onCancel={() => setView('grid')}
        onCreated={handleCreated}
      />
    )
  }

  if (view === 'detail') {
    const entry = entries.find((e) => e.id === selectedEntryId)
    if (!entry) {
      setView('grid')
      return null
    }
    return (
      <PassportDetail
        entry={entry}
        photos={photosByEntry[entry.id] || []}
        userId={userId}
        onBack={() => setView('grid')}
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
      <div className="explore-header">
        <p className="explore-subtitle">Every place you've actually been.</p>
      </div>

      <button type="button" className="intake-submit-btn passport-add-btn" onClick={() => setView('form')}>
        + Add a stamp
      </button>

      {loading ? (
        <p className="explore-empty">Loading your passport…</p>
      ) : entries.length === 0 ? (
        <p className="explore-empty">No stamps yet — add your first place above.</p>
      ) : (
        <div className="passport-grid">
          {entries.map((entry) => {
            const cover = photosByEntry[entry.id]?.[0]
            return (
              <button key={entry.id} type="button" className="passport-stamp-card" onClick={() => openEntry(entry)}>
                {cover?.url ? (
                  <img src={cover.url} alt="" className="passport-stamp-image" />
                ) : (
                  <div className="passport-stamp-placeholder" aria-hidden="true" />
                )}
                <span className="passport-stamp-name">{entry.place_name}</span>
                {entry.visited_on && <span className="passport-stamp-date">{formatDate(entry.visited_on)}</span>}
              </button>
            )
          })}
        </div>
      )}
    </main>
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
      <div className="explore-header">
        <button type="button" className="bucket-list-back" onClick={onCancel}>
          ← Passport
        </button>
        <h1>Add a stamp</h1>
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

function PassportDetail({ entry, photos, userId, onBack, onUpdated, onDelete, onPhotoAdded, onPhotoRemoved }) {
  const [visitedOn, setVisitedOn] = useState(entry.visited_on || '')
  const [note, setNote] = useState(entry.note || '')
  const [newFiles, setNewFiles] = useState([])
  const [statuses, setStatuses] = useState([])
  const [uploading, setUploading] = useState(false)

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

  return (
    <main className="passport-page">
      <div className="explore-header">
        <button type="button" className="bucket-list-back" onClick={onBack}>
          ← Passport
        </button>
        <div className="bucket-list-detail-title-row">
          <h1>{entry.place_name}</h1>
          <button type="button" className="bucket-list-icon-btn" aria-label={`Delete stamp for ${entry.place_name}`} onClick={onDelete}>
            ×
          </button>
        </div>
        {entry.city && <p className="explore-subtitle">{entry.city}</p>}
      </div>

      {photos.length > 0 && (
        <div className="passport-detail-photos">
          {photos.map((photo) => (
            <div key={photo.id} className="passport-detail-photo">
              {photo.url ? <img src={photo.url} alt="" /> : <div className="passport-stamp-placeholder" aria-hidden="true" />}
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
    </main>
  )
}
