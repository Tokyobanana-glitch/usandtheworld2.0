import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { getSupabaseClient } from './services/supabaseClient'
import { migrateLocalDataToAccount } from './services/accountMigration'
import SignInSheet from './SignInSheet'
import ProfileSheet from './components/ProfileSheet'

const AuthContext = createContext(null)

// Wraps Supabase Auth session state for the whole app. Search and itinerary
// generation stay fully anonymous regardless of auth state — this context
// exists only to gate SAVE actions (bucket list, passport, claiming a trip),
// never to block the core product. requestSignIn() is how a future save
// button opens the sheet; nothing in this pass calls it yet, since Bucket
// List/Passport don't have UI in this pass — see SignInSheet.jsx.
export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)

  useEffect(() => {
    const supabase = getSupabaseClient()
    if (!supabase) {
      setLoading(false)
      return
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    // persistSession + autoRefreshToken (set on the client itself) keep the
    // session alive across reloads and token expiry; this listener is what
    // keeps React state in sync with that — including the one-time
    // localStorage -> account migration, which only ever needs to run right
    // after a fresh SIGNED_IN (never on the initial getSession() restore of
    // an already-existing session, which would re-run it on every page load
    // for no reason).
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession)
      if (event === 'SIGNED_IN' && newSession) {
        migrateLocalDataToAccount(newSession).catch((err) => {
          console.error('account migration failed:', err)
        })
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const requestSignIn = useCallback(() => setSheetOpen(true), [])
  const closeSignInSheet = useCallback(() => setSheetOpen(false), [])
  const requestProfile = useCallback(() => setProfileOpen(true), [])
  const closeProfile = useCallback(() => setProfileOpen(false), [])

  const value = useMemo(
    () => ({ session, user: session?.user ?? null, loading, requestSignIn, requestProfile }),
    [session, loading, requestSignIn, requestProfile],
  )

  return (
    <AuthContext.Provider value={value}>
      {children}
      {sheetOpen && <SignInSheet onClose={closeSignInSheet} />}
      {profileOpen && <ProfileSheet onClose={closeProfile} />}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
