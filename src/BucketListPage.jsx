import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { getSupabaseClient } from './services/supabaseClient'
import { createPassportEntryFromPlace, addPlaceToBucketList, addPlaceToNewBucketList } from './services/quickSaves'
import { citySlug, illustrationUrl, resolveDestinationImage } from './curatedMedia'
import PageHeader from './components/PageHeader'
import EmptyState from './components/EmptyState'
import Carousel from './components/Carousel'
import Image from './components/Image'
import BottomSheet from './components/BottomSheet'
import './BucketListPage.css'

const INSPIRE_LIMIT = 12
const EMPTY_SET = new Set()

// Flattens every brief's highlights (famous places, not the city itself)
// into one list for the "Need inspiration?" carousel — see
// design-reference/DESIGN_REFERENCE.md's Bucket List section.
function flattenHighlights(briefs) {
  const items = []
  for (const brief of briefs) {
    if (!Array.isArray(brief.highlights)) continue
    for (const highlight of brief.highlights) {
      if (!highlight?.name) continue
      items.push({
        key: `${brief.id}-${highlight.name}`,
        name: highlight.name,
        line: highlight.line,
        city: brief.city,
        country: brief.country,
      })
    }
  }
  return items
}

// Resolves an image through curatedMedia's full fallback chain (curated tier
// by city slug, then a live Wikipedia lookup by the place's own name, then
// null — see curatedMedia.js). Used for bucket list cover images, and for
// inspiration-carousel/item photos, none of which have a curated slug of
// their own the way an explore_briefs city does.
function useResolvedImage({ slug, wikipediaTitle, kind = 'card' }) {
  const [src, setSrc] = useState(null)
  useEffect(() => {
    let cancelled = false
    setSrc(null)
    if (!slug && !wikipediaTitle) return undefined
    resolveDestinationImage({ slug, wikipediaTitle, kind }).then((url) => {
      if (!cancelled) setSrc(url)
    })
    return () => {
      cancelled = true
    }
  }, [slug, wikipediaTitle, kind])
  return src
}

// Same explore_briefs read ExploreContent.jsx does — duplicated rather than
// shared because that component's chunk isn't guaranteed loaded on this tab
// (only App.jsx's own eager bundle is), and this is the only other place
// that currently wants briefs.
function useExploreBriefs() {
  const [briefs, setBriefs] = useState(null)
  useEffect(() => {
    let cancelled = false
    const supabase = getSupabaseClient()
    if (!supabase) {
      setBriefs([])
      return
    }
    supabase
      .from('explore_briefs')
      .select('*')
      .order('city', { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return
        setBriefs(error ? [] : data || [])
      })
    return () => {
      cancelled = true
    }
  }, [])
  return briefs
}

// A brief's highlight name sometimes carries a parenthetical aside (e.g.
// "Wat Arun (Temple of Dawn)") that breaks an exact Wikipedia title match —
// stripped before the lookup in InspireCard below.
function stripParenthetical(name) {
  return name.replace(/\s*\([^)]*\)\s*$/, '').trim()
}

function HeartIcon({ filled }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d="M12 20.5s-7.5-4.6-10-9.3C.7 8 2 4.8 5.2 3.9c2-.6 4 .2 5.2 2 .3.4.9.4 1.2 0 1.2-1.8 3.2-2.6 5.2-2 3.2.9 4.5 4.1 3.2 7.3-2.5 4.7-10 9.3-10 9.3z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// Reads and writes bucket_lists / bucket_list_items directly through the
// authed browser client (see services/supabaseClient.js) — RLS scopes every
// select/update/delete to auth.uid() already (see
// supabase/004_auth_bucket_passport.sql), so none of the queries below add
// an owner filter of their own. Only INSERT needs owner explicitly: RLS
// validates it against auth.uid() via WITH CHECK, it doesn't fill it in.
export default function BucketListPage() {
  const { user, loading: authLoading, requestSignIn } = useAuth()
  const briefs = useExploreBriefs()

  if (authLoading) return <main className="bucket-list-page" />

  if (!user) {
    return (
      <main className="bucket-list-page">
        <PageHeader variant="large" title="Bucket List" />
        <div className="bucket-list-body">
          <EmptyState
            illustrationSrc={illustrationUrl('bucket-list')}
            title="Sign in to start your list"
            description="Save every place you want to go — across every trip you're dreaming up, in one list."
            ctaLabel="Sign in"
            onCtaClick={requestSignIn}
            card
          />
          <BucketListInspire briefs={briefs} addedKeys={EMPTY_SET} onHeart={requestSignIn} />
          <GetInspiredLink />
        </div>
      </main>
    )
  }

  return <SignedInBucketList userId={user.id} briefs={briefs} />
}

function GetInspiredLink() {
  return (
    <div className="bucket-list-get-inspired">
      <Link to="/" className="bucket-list-get-inspired-link">
        Get inspired
      </Link>
    </div>
  )
}

function BucketListInspire({ briefs, addedKeys, onHeart }) {
  if (!briefs || briefs.length === 0) return null
  const items = flattenHighlights(briefs).slice(0, INSPIRE_LIMIT)
  if (items.length === 0) return null

  return (
    <div className="bucket-list-inspire-section">
      <div className="bucket-list-section-header">
        <h3 className="explore-section-heading">Need inspiration?</h3>
        <p className="explore-section-subtitle">Famous places worth adding to your list.</p>
      </div>
      <Carousel variant="left-aligned" ariaLabel="Places to add to your bucket list">
        {items.map((item) => (
          <InspireCard key={item.key} item={item} added={addedKeys.has(item.key)} onHeart={() => onHeart(item)} />
        ))}
      </Carousel>
    </div>
  )
}

function InspireCard({ item, added, onHeart }) {
  // No curated slug here on purpose — each card is a specific famous place,
  // not a destination, and every curated city photo (see curatedMedia.js) is
  // one generic shot per city; passing a slug would make every highlight in
  // that city show that same photo instead of its own.
  const imageSrc = useResolvedImage({ wikipediaTitle: stripParenthetical(item.name), kind: 'card' })

  return (
    <div className="bucket-list-inspire-card">
      <div className="bucket-list-inspire-card-media">
        <Image src={imageSrc} alt={item.name} aspectRatio="3 / 4" className="bucket-list-inspire-card-image" />
        <button
          type="button"
          className={`bucket-list-heart-btn${added ? ' bucket-list-heart-btn--added' : ''}`}
          aria-label={added ? `${item.name} added to your list` : `Add ${item.name} to a bucket list`}
          onClick={onHeart}
          disabled={added}
        >
          <HeartIcon filled={added} />
        </button>
      </div>
      <div className="bucket-list-inspire-card-footer">
        <span className="bucket-list-inspire-card-title">{item.name}</span>
        {item.city && <span className="bucket-list-inspire-card-place">{item.city}</span>}
      </div>
    </div>
  )
}

function SignedInBucketList({ userId, briefs }) {
  const [view, setView] = useState('lists') // 'lists' | 'detail'
  const [lists, setLists] = useState([])
  const [firstItemByList, setFirstItemByList] = useState({})
  const [listsLoading, setListsLoading] = useState(true)
  const [listsError, setListsError] = useState(null)

  const [createSheetOpen, setCreateSheetOpen] = useState(false)
  const [newListName, setNewListName] = useState('')
  const [creatingList, setCreatingList] = useState(false)
  const [editingListId, setEditingListId] = useState(null)
  const [renameValue, setRenameValue] = useState('')

  const [heartedKeys, setHeartedKeys] = useState(() => new Set())
  const [pendingHeartItem, setPendingHeartItem] = useState(null)

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
      setListsLoading(false)
      return
    }
    setListsError(null)
    const loadedLists = data ?? []
    setLists(loadedLists)

    if (loadedLists.length === 0) {
      setFirstItemByList({})
      setListsLoading(false)
      return
    }

    // One query for every list's items, grouped client-side to the earliest
    // per list_id — cheaper than a per-list query for the cover photo.
    const { data: itemRows, error: itemsError } = await supabase
      .from('bucket_list_items')
      .select('list_id, place_name, city')
      .order('added_at', { ascending: true })
    if (itemsError) {
      console.error('bucket_list_items cover lookup error:', itemsError)
      setFirstItemByList({})
    } else {
      const map = {}
      ;(itemRows ?? []).forEach((row) => {
        if (!(row.list_id in map)) map[row.list_id] = row
      })
      setFirstItemByList(map)
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
    setCreateSheetOpen(false)
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

  // Bucket List -> Passport: a one-time action, not a persisted "visited"
  // flag on the item — bucket_list_items has no such column, and adding one
  // would be a schema change this phase doesn't need. The item stays on the
  // list either way; this just also creates a Passport entry for it.
  async function markItemVisited(item) {
    const entry = await createPassportEntryFromPlace(userId, {
      name: item.place_name,
      city: item.city,
      lat: item.lat,
      lng: item.lng,
    })
    return !!entry
  }

  function bumpListCount(listId, item) {
    setLists((prev) =>
      prev.map((l) =>
        l.id === listId ? { ...l, bucket_list_items: [{ count: (l.bucket_list_items?.[0]?.count ?? 0) + 1 }] } : l,
      ),
    )
    setFirstItemByList((prev) => (prev[listId] ? prev : { ...prev, [listId]: { place_name: item.name, city: item.city } }))
  }

  // Inspiration carousel's heart — no list picker needed when there's zero
  // or one list to choose from; otherwise opens the picker sheet and waits
  // for handlePickList.
  async function handleHeart(item) {
    if (lists.length === 0) {
      const saved = await addPlaceToNewBucketList(userId, { name: item.name, city: item.city })
      if (saved) {
        setHeartedKeys((prev) => new Set(prev).add(item.key))
        await loadLists()
      }
      return
    }
    if (lists.length === 1) {
      const saved = await addPlaceToBucketList(lists[0].id, { name: item.name, city: item.city })
      if (saved) {
        setHeartedKeys((prev) => new Set(prev).add(item.key))
        bumpListCount(lists[0].id, item)
      }
      return
    }
    setPendingHeartItem(item)
  }

  async function handlePickList(list) {
    const item = pendingHeartItem
    setPendingHeartItem(null)
    if (!item) return
    const saved = await addPlaceToBucketList(list.id, { name: item.name, city: item.city })
    if (saved) {
      setHeartedKeys((prev) => new Set(prev).add(item.key))
      bumpListCount(list.id, item)
    }
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
        onMarkVisited={markItemVisited}
      />
    )
  }

  return (
    <main className="bucket-list-page">
      <PageHeader variant="large" title="Bucket List" />
      <div className="bucket-list-body">
        {listsError && <p className="result-error">{listsError}</p>}

        {listsLoading ? (
          <p className="explore-empty">Loading your lists…</p>
        ) : lists.length === 0 ? (
          <EmptyState
            illustrationSrc={illustrationUrl('bucket-list')}
            title="Let's get started"
            description="Create a list and start saving the places you want to go."
            ctaLabel="Create a bucket list"
            onCtaClick={() => setCreateSheetOpen(true)}
            card
          />
        ) : (
          <>
            <div className="bucket-list-toolbar">
              <button type="button" className="bucket-list-new-link" onClick={() => setCreateSheetOpen(true)}>
                + New list
              </button>
            </div>
            <div className="bucket-list-grid">
              {lists.map((list) => (
                <BucketListCard key={list.id} list={list} firstItem={firstItemByList[list.id]} onClick={() => openList(list)} />
              ))}
            </div>
          </>
        )}

        <BucketListInspire briefs={briefs} addedKeys={heartedKeys} onHeart={handleHeart} />
        <GetInspiredLink />
      </div>

      {createSheetOpen && (
        <BottomSheet title="Create a bucket list" onClose={() => setCreateSheetOpen(false)}>
          <form className="bucket-list-create-form" onSubmit={handleCreateList}>
            <input
              type="text"
              className="intake-notes-input"
              placeholder="List name — e.g. Someday in Japan"
              value={newListName}
              onChange={(event) => setNewListName(event.target.value)}
              maxLength={80}
              autoFocus
            />
            <button type="submit" className="intake-submit-btn" disabled={creatingList || !newListName.trim()}>
              {creatingList ? 'Creating…' : 'Create list'}
            </button>
          </form>
        </BottomSheet>
      )}

      {pendingHeartItem && (
        <BottomSheet title={`Add "${pendingHeartItem.name}" to…`} onClose={() => setPendingHeartItem(null)}>
          <div className="bucket-list-picker">
            {lists.map((list) => {
              const count = list.bucket_list_items?.[0]?.count ?? 0
              return (
                <button key={list.id} type="button" className="bucket-list-picker-option" onClick={() => handlePickList(list)}>
                  <span className="bucket-list-picker-option-name">{list.name}</span>
                  <span className="bucket-list-picker-option-meta">
                    {count} place{count === 1 ? '' : 's'}
                  </span>
                </button>
              )
            })}
          </div>
        </BottomSheet>
      )}
    </main>
  )
}

function BucketListCard({ list, firstItem, onClick }) {
  const imageSrc = useResolvedImage({
    slug: firstItem?.city ? citySlug(firstItem.city) : undefined,
    wikipediaTitle: firstItem?.place_name,
    kind: 'card',
  })
  const count = list.bucket_list_items?.[0]?.count ?? 0

  return (
    <button type="button" className="bucket-list-cover-card" onClick={onClick}>
      <Image src={imageSrc} alt="" aspectRatio="4 / 3" className="bucket-list-cover-card-image" />
      <div className="bucket-list-cover-card-footer">
        <span className="bucket-list-cover-card-name">{list.name}</span>
        <span className="bucket-list-cover-card-meta">
          {count} place{count === 1 ? '' : 's'}
        </span>
      </div>
    </button>
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
  onMarkVisited,
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
    const item = await addPlaceToBucketList(list.id, { name, city })
    setAddingPlace(false)
    if (!item) {
      setAddPlaceError('Could not add this place — please try again.')
      return
    }
    setPlaceName('')
    setPlaceCity('')
    onItemAdded(item)
  }

  return (
    <main className="bucket-list-page">
      <div className="bucket-list-detail-header">
        <button type="button" className="bucket-list-back" onClick={onBack}>
          ← All lists
        </button>
        {editingListId === list.id ? (
          <form
            className="bucket-list-detail-rename-form"
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

      <div className="bucket-list-detail-body">
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
              <BucketListItemCard
                key={item.id}
                item={item}
                onRemove={() => onRemoveItem(item.id)}
                onUpdateNote={onUpdateNote}
                onMarkVisited={onMarkVisited}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  )
}

function BucketListItemCard({ item, onRemove, onUpdateNote, onMarkVisited }) {
  const [note, setNote] = useState(item.note ?? '')
  const [visitedStatus, setVisitedStatus] = useState('idle') // idle | saving | done
  const imageSrc = useResolvedImage({ slug: item.city ? citySlug(item.city) : undefined, wikipediaTitle: item.place_name, kind: 'card' })

  async function handleMarkVisited() {
    setVisitedStatus('saving')
    const ok = await onMarkVisited(item)
    setVisitedStatus(ok ? 'done' : 'idle')
  }

  return (
    <div className="bucket-list-item-card">
      <Image src={imageSrc} alt="" aspectRatio="16 / 9" className="bucket-list-item-image" />
      <div className="bucket-list-item-body">
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
        <div className="bucket-list-item-actions">
          {visitedStatus === 'done' ? (
            <span className="bucket-list-item-visited">Added to Passport ✓</span>
          ) : (
            <button type="button" className="bucket-list-mark-visited" onClick={handleMarkVisited} disabled={visitedStatus === 'saving'}>
              {visitedStatus === 'saving' ? 'Adding…' : 'Mark visited'}
            </button>
          )}
          <button type="button" className="bucket-list-icon-btn" aria-label={`Remove ${item.place_name}`} onClick={onRemove}>
            ×
          </button>
        </div>
      </div>
    </div>
  )
}
