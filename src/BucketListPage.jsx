import { useCallback, useEffect, useState } from 'react'
import { useAuth } from './AuthContext'
import { getSupabaseClient } from './services/supabaseClient'
import DiscoverFeed from './DiscoverFeed'

// Reads and writes bucket_lists / bucket_list_items directly through the
// authed browser client (see services/supabaseClient.js) — RLS scopes every
// select/update/delete to auth.uid() already (see
// supabase/004_auth_bucket_passport.sql), so none of the queries below add
// an owner filter of their own. Only INSERT needs owner explicitly: RLS
// validates it against auth.uid() via WITH CHECK, it doesn't fill it in.
export default function BucketListPage() {
  const { user, loading: authLoading, requestSignIn } = useAuth()

  if (authLoading) return <main className="bucket-list-page" />

  if (!user) {
    return (
      <main className="bucket-list-page">
        <div className="explore-header">
          <h1>Bucket List</h1>
          <p className="explore-subtitle">Save the places you want to go — across every trip you're dreaming up, in one list.</p>
        </div>
        <div className="tab-auth-pitch">
          <p>Sign in to start your list. It's saved to your account, so it's there next time you open the app on any device.</p>
          <button type="button" className="intake-submit-btn" onClick={requestSignIn}>
            Sign in to get started
          </button>
        </div>
        <BucketListInspire />
      </main>
    )
  }

  return <SignedInBucketList userId={user.id} />
}

function BucketListInspire() {
  return (
    <div className="bucket-list-inspire">
      <h3 className="discover-feed-title">Get inspired</h3>
      <DiscoverFeed />
    </div>
  )
}

function SignedInBucketList({ userId }) {
  const [view, setView] = useState('lists') // 'lists' | 'detail'
  const [lists, setLists] = useState([])
  const [listsLoading, setListsLoading] = useState(true)
  const [listsError, setListsError] = useState(null)

  const [newListName, setNewListName] = useState('')
  const [creatingList, setCreatingList] = useState(false)
  const [editingListId, setEditingListId] = useState(null)
  const [renameValue, setRenameValue] = useState('')

  const [selectedList, setSelectedList] = useState(null)
  const [items, setItems] = useState([])
  const [itemsLoading, setItemsLoading] = useState(false)

  const loadLists = useCallback(async () => {
    const supabase = getSupabaseClient()
    if (!supabase) {
      setListsError('Bucket List is temporarily unavailable — please try again in a moment.')
      setListsLoading(false)
      return
    }
    setListsLoading(true)
    const { data, error } = await supabase
      .from('bucket_lists')
      .select('*, bucket_list_items(count)')
      .order('created_at', { ascending: true })
    if (error) {
      console.error('bucket_lists load error:', error)
      setListsError('Could not load your lists.')
    } else {
      setListsError(null)
      setLists(data ?? [])
    }
    setListsLoading(false)
  }, [])

  useEffect(() => {
    loadLists()
  }, [loadLists])

  async function handleCreateList(event) {
    event.preventDefault()
    const name = newListName.trim()
    if (!name) return
    const supabase = getSupabaseClient()
    if (!supabase) return
    setCreatingList(true)
    const { data, error } = await supabase.from('bucket_lists').insert({ owner: userId, name }).select().single()
    setCreatingList(false)
    if (error) {
      console.error('bucket_lists create error:', error)
      return
    }
    setNewListName('')
    await loadLists()
    openList({ ...data, bucket_list_items: [{ count: 0 }] })
  }

  async function handleRenameList(listId) {
    const name = renameValue.trim()
    setEditingListId(null)
    if (!name) return
    const supabase = getSupabaseClient()
    if (!supabase) return
    const { error } = await supabase.from('bucket_lists').update({ name }).eq('id', listId)
    if (error) {
      console.error('bucket_lists rename error:', error)
      return
    }
    setLists((prev) => prev.map((l) => (l.id === listId ? { ...l, name } : l)))
    setSelectedList((prev) => (prev && prev.id === listId ? { ...prev, name } : prev))
  }

  async function handleDeleteList(list) {
    if (!window.confirm(`Delete "${list.name}"? This removes every place saved in it.`)) return
    const supabase = getSupabaseClient()
    if (!supabase) return
    const { error } = await supabase.from('bucket_lists').delete().eq('id', list.id)
    if (error) {
      console.error('bucket_lists delete error:', error)
      return
    }
    setLists((prev) => prev.filter((l) => l.id !== list.id))
    if (selectedList?.id === list.id) {
      setSelectedList(null)
      setView('lists')
    }
  }

  async function openList(list) {
    setSelectedList(list)
    setView('detail')
    setItemsLoading(true)
    const supabase = getSupabaseClient()
    if (!supabase) {
      setItemsLoading(false)
      return
    }
    const { data, error } = await supabase
      .from('bucket_list_items')
      .select('*')
      .eq('list_id', list.id)
      .order('added_at', { ascending: true })
    if (error) {
      console.error('bucket_list_items load error:', error)
      setItems([])
    } else {
      setItems(data ?? [])
    }
    setItemsLoading(false)
  }

  function backToLists() {
    setView('lists')
    setSelectedList(null)
    loadLists()
  }

  function handleItemAdded(item) {
    setItems((prev) => [...prev, item])
    setLists((prev) =>
      prev.map((l) =>
        l.id === item.list_id
          ? { ...l, bucket_list_items: [{ count: (l.bucket_list_items?.[0]?.count ?? 0) + 1 }] }
          : l,
      ),
    )
  }

  async function removeItem(itemId) {
    const supabase = getSupabaseClient()
    if (!supabase) return
    const { error } = await supabase.from('bucket_list_items').delete().eq('id', itemId)
    if (error) {
      console.error('bucket_list_items delete error:', error)
      return
    }
    setItems((prev) => prev.filter((i) => i.id !== itemId))
    setLists((prev) =>
      prev.map((l) =>
        l.id === selectedList?.id
          ? { ...l, bucket_list_items: [{ count: Math.max(0, (l.bucket_list_items?.[0]?.count ?? 1) - 1) }] }
          : l,
      ),
    )
  }

  async function updateItemNote(itemId, note) {
    const supabase = getSupabaseClient()
    if (!supabase) return
    const trimmed = note.trim()
    const { error } = await supabase.from('bucket_list_items').update({ note: trimmed || null }).eq('id', itemId)
    if (error) console.error('bucket_list_items note update error:', error)
  }

  if (view === 'detail' && selectedList) {
    return (
      <BucketListDetail
        list={selectedList}
        items={items}
        loading={itemsLoading}
        editingListId={editingListId}
        renameValue={renameValue}
        onBack={backToLists}
        onStartRename={() => {
          setEditingListId(selectedList.id)
          setRenameValue(selectedList.name)
        }}
        onRenameValueChange={setRenameValue}
        onRenameSubmit={() => handleRenameList(selectedList.id)}
        onRenameCancel={() => setEditingListId(null)}
        onDelete={() => handleDeleteList(selectedList)}
        onItemAdded={handleItemAdded}
        onRemoveItem={removeItem}
        onUpdateNote={updateItemNote}
      />
    )
  }

  return (
    <main className="bucket-list-page">
      <div className="explore-header">
        <h1>Bucket List</h1>
        <p className="explore-subtitle">Places you want to go, organized however you like.</p>
      </div>

      <form className="bucket-list-inline-form" onSubmit={handleCreateList}>
        <input
          type="text"
          className="intake-notes-input"
          placeholder="New list name — e.g. Someday in Japan"
          value={newListName}
          onChange={(event) => setNewListName(event.target.value)}
          maxLength={80}
        />
        <button type="submit" className="intake-submit-btn" disabled={creatingList || !newListName.trim()}>
          {creatingList ? 'Creating…' : '+ New list'}
        </button>
      </form>

      {listsError && <p className="result-error">{listsError}</p>}

      {listsLoading ? (
        <p className="explore-empty">Loading your lists…</p>
      ) : lists.length === 0 ? (
        <p className="explore-empty">No lists yet — name one above to start saving places.</p>
      ) : (
        <div className="bucket-list-grid">
          {lists.map((list) => {
            const count = list.bucket_list_items?.[0]?.count ?? 0
            return (
              <div key={list.id} className="bucket-list-card">
                {editingListId === list.id ? (
                  <form
                    className="bucket-list-card-rename"
                    onSubmit={(event) => {
                      event.preventDefault()
                      handleRenameList(list.id)
                    }}
                  >
                    <input
                      type="text"
                      className="intake-notes-input"
                      value={renameValue}
                      onChange={(event) => setRenameValue(event.target.value)}
                      autoFocus
                      maxLength={80}
                    />
                    <button type="submit" className="bucket-list-icon-btn" aria-label="Save name">
                      ✓
                    </button>
                    <button type="button" className="bucket-list-icon-btn" aria-label="Cancel rename" onClick={() => setEditingListId(null)}>
                      ×
                    </button>
                  </form>
                ) : (
                  <>
                    <button type="button" className="bucket-list-card-open" onClick={() => openList(list)}>
                      <span className="bucket-list-card-name">{list.name}</span>
                      <span className="bucket-list-card-meta">
                        {count} place{count === 1 ? '' : 's'}
                      </span>
                    </button>
                    <div className="bucket-list-card-actions">
                      <button
                        type="button"
                        className="bucket-list-icon-btn"
                        aria-label={`Rename ${list.name}`}
                        onClick={() => {
                          setEditingListId(list.id)
                          setRenameValue(list.name)
                        }}
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        className="bucket-list-icon-btn"
                        aria-label={`Delete ${list.name}`}
                        onClick={() => handleDeleteList(list)}
                      >
                        ×
                      </button>
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}

      <BucketListInspire />
    </main>
  )
}

function BucketListDetail({
  list,
  items,
  loading,
  editingListId,
  renameValue,
  onBack,
  onStartRename,
  onRenameValueChange,
  onRenameSubmit,
  onRenameCancel,
  onDelete,
  onItemAdded,
  onRemoveItem,
  onUpdateNote,
}) {
  const [placeName, setPlaceName] = useState('')
  const [placeCity, setPlaceCity] = useState('')
  const [addingPlace, setAddingPlace] = useState(false)
  const [addPlaceError, setAddPlaceError] = useState(null)

  async function handleAddPlace(event) {
    event.preventDefault()
    const name = placeName.trim()
    const city = placeCity.trim()
    if (!name || !city) return

    setAddingPlace(true)
    setAddPlaceError(null)

    let geocoded = { lat: null, lng: null, placeKey: null }
    try {
      const res = await fetch('/api/trip-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'geocode-place', name, city }),
      })
      if (res.ok) {
        geocoded = await res.json()
      }
    } catch (err) {
      console.error('geocode-place request failed:', err)
    }
    // A place that fails to geocode still saves — lat/lng null, same
    // graceful degradation an unlocatable itinerary stop gets.

    const supabase = getSupabaseClient()
    if (!supabase) {
      setAddingPlace(false)
      setAddPlaceError('Could not add this place — please try again.')
      return
    }
    const { data, error } = await supabase
      .from('bucket_list_items')
      .insert({
        list_id: list.id,
        place_name: name,
        city,
        lat: geocoded.lat ?? null,
        lng: geocoded.lng ?? null,
        place_key: geocoded.placeKey ?? null,
      })
      .select()
      .single()

    setAddingPlace(false)
    if (error) {
      console.error('bucket_list_items insert error:', error)
      setAddPlaceError('Could not add this place — please try again.')
      return
    }
    setPlaceName('')
    setPlaceCity('')
    onItemAdded(data)
  }

  return (
    <main className="bucket-list-page">
      <div className="explore-header">
        <button type="button" className="bucket-list-back" onClick={onBack}>
          ← All lists
        </button>
        {editingListId === list.id ? (
          <form
            className="bucket-list-card-rename bucket-list-detail-rename"
            onSubmit={(event) => {
              event.preventDefault()
              onRenameSubmit()
            }}
          >
            <input
              type="text"
              className="intake-notes-input"
              value={renameValue}
              onChange={(event) => onRenameValueChange(event.target.value)}
              autoFocus
              maxLength={80}
            />
            <button type="submit" className="bucket-list-icon-btn" aria-label="Save name">
              ✓
            </button>
            <button type="button" className="bucket-list-icon-btn" aria-label="Cancel rename" onClick={onRenameCancel}>
              ×
            </button>
          </form>
        ) : (
          <div className="bucket-list-detail-title-row">
            <h1>{list.name}</h1>
            <button type="button" className="bucket-list-icon-btn" aria-label={`Rename ${list.name}`} onClick={onStartRename}>
              ✎
            </button>
            <button type="button" className="bucket-list-icon-btn" aria-label={`Delete ${list.name}`} onClick={onDelete}>
              ×
            </button>
          </div>
        )}
      </div>

      <form className="bucket-list-add-place" onSubmit={handleAddPlace}>
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
          value={placeCity}
          onChange={(event) => setPlaceCity(event.target.value)}
        />
        <button type="submit" className="intake-submit-btn" disabled={addingPlace || !placeName.trim() || !placeCity.trim()}>
          {addingPlace ? 'Adding…' : '+ Add a place'}
        </button>
      </form>
      {addPlaceError && <p className="result-error">{addPlaceError}</p>}

      {loading ? (
        <p className="explore-empty">Loading places…</p>
      ) : items.length === 0 ? (
        <p className="explore-empty">No places yet — add one above.</p>
      ) : (
        <div className="bucket-list-item-list">
          {items.map((item) => (
            <BucketListItemCard key={item.id} item={item} onRemove={() => onRemoveItem(item.id)} onUpdateNote={onUpdateNote} />
          ))}
        </div>
      )}
    </main>
  )
}

function BucketListItemCard({ item, onRemove, onUpdateNote }) {
  const [note, setNote] = useState(item.note ?? '')

  return (
    <div className="bucket-list-item-card">
      <div className="bucket-list-item-main">
        <span className="bucket-list-item-name">{item.place_name}</span>
        {item.city && <span className="bucket-list-item-city">{item.city}</span>}
        {item.lat == null && <span className="bucket-list-item-unlocatable">Location not found — saved anyway</span>}
      </div>
      <input
        type="text"
        className="bucket-list-item-note"
        placeholder="Add a note…"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        onBlur={() => {
          if (note !== (item.note ?? '')) onUpdateNote(item.id, note)
        }}
      />
      <button type="button" className="bucket-list-icon-btn" aria-label={`Remove ${item.place_name}`} onClick={onRemove}>
        ×
      </button>
    </div>
  )
}
