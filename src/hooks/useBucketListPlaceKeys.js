import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../AuthContext'
import { fetchBucketListPlaceKeys, saveStopToBucketList } from '../services/quickSaves'

// Shared by App.jsx's live search flow and TripPage.jsx's saved-trip view —
// both need "does this stop's placeKey match something on my bucket list"
// for the same visible flag (see StopCard's isOnBucketList prop). Empty Set
// when signed out or before the fetch resolves — StopCard renders nothing
// extra either way, so there's no loading state to thread through.
export function useBucketListPlaceKeys() {
  const { user } = useAuth()
  const [placeKeys, setPlaceKeys] = useState(() => new Set())

  const refresh = useCallback(async () => {
    if (!user) {
      setPlaceKeys(new Set())
      return
    }
    setPlaceKeys(await fetchBucketListPlaceKeys())
  }, [user])

  useEffect(() => {
    refresh()
  }, [refresh])

  return [placeKeys, refresh]
}

// Composes the above with the actual "+ Save to bucket list" action and its
// per-stop saving/saved status — everything StopCard needs, in one hook, so
// App.jsx and TripPage.jsx wire this up identically with no duplicated
// state machinery between them.
export function useBucketListQuickSave() {
  const { user, requestSignIn } = useAuth()
  const [placeKeys, refresh] = useBucketListPlaceKeys()
  const [saveStatus, setSaveStatus] = useState({}) // placeKey -> 'saving' | 'saved'

  const onSaveToBucketList = useCallback(
    async (stop) => {
      if (!user) {
        requestSignIn()
        return
      }
      if (!stop.placeKey) return
      setSaveStatus((prev) => ({ ...prev, [stop.placeKey]: 'saving' }))
      const item = await saveStopToBucketList(user.id, stop)
      if (item) {
        setSaveStatus((prev) => ({ ...prev, [stop.placeKey]: 'saved' }))
        refresh()
      } else {
        setSaveStatus((prev) => {
          const next = { ...prev }
          delete next[stop.placeKey]
          return next
        })
      }
    },
    [user, requestSignIn, refresh],
  )

  return { bucketListKeys: placeKeys, bucketListSaveStatus: saveStatus, onSaveToBucketList }
}
