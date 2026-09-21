import { useState } from 'react'
import { useAuth } from '../AuthContext'
import { getSupabaseClient } from '../services/supabaseClient'
import { clearIntakePreferences } from '../services/intakePreferences'
import { useInstallPrompt } from '../hooks/useInstallPrompt'
import BottomSheet from './BottomSheet'
import ListGroup from './ListGroup'
import ListRow from './ListRow'
import './ProfileSheet.css'

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <circle cx="12" cy="8.5" r="4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4.5 20c1.4-3.8 4.4-5.8 7.5-5.8s6.1 2 7.5 5.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function PreferencesIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path d="M4 7h11M4 12h16M4 17h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="18" cy="7" r="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="9" cy="17" r="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  )
}

// Only rows that do something, per the reference — no Cardmember Benefits/
// Loyalty Programs/Companions-style rows with nowhere real to go.
export default function ProfileSheet({ onClose }) {
  const { user, requestSignIn } = useAuth()
  const { canInstall, promptInstall } = useInstallPrompt()
  const [signingOut, setSigningOut] = useState(false)
  const [prefsCleared, setPrefsCleared] = useState(false)

  async function handleSignOut() {
    setSigningOut(true)
    const supabase = getSupabaseClient()
    await supabase?.auth.signOut()
    setSigningOut(false)
    onClose()
  }

  function handleSignIn() {
    onClose()
    requestSignIn()
  }

  function handleClearPreferences() {
    clearIntakePreferences()
    setPrefsCleared(true)
  }

  return (
    <BottomSheet title="Profile" onClose={onClose} size="full">
      <h1 className="profile-sheet-title">Profile</h1>

      <section className="profile-sheet-section">
        <h2 className="profile-sheet-heading">Account</h2>
        <ListGroup>
          {user ? (
            <>
              <ListRow icon={<PersonIcon />} label={user.email} trailing={null} />
              <ListRow label={signingOut ? 'Signing out…' : 'Sign out'} onClick={handleSignOut} trailing={null} />
            </>
          ) : (
            <ListRow icon={<PersonIcon />} label="Sign in" sublabel="Save trips, bucket list places, and passport stamps" onClick={handleSignIn} />
          )}
        </ListGroup>
      </section>

      <section className="profile-sheet-section">
        <h2 className="profile-sheet-heading">Travel preferences</h2>
        <ListGroup>
          <ListRow
            icon={<PreferencesIcon />}
            label="Clear saved preferences"
            sublabel={prefsCleared ? 'Cleared' : 'Trip length, budget, pace, and interests'}
            onClick={handleClearPreferences}
            trailing={null}
          />
        </ListGroup>
      </section>

      {canInstall && (
        <section className="profile-sheet-section">
          <h2 className="profile-sheet-heading">App</h2>
          <ListGroup>
            <ListRow icon={<DownloadIcon />} label="Install app" onClick={promptInstall} trailing={null} />
          </ListGroup>
        </section>
      )}
    </BottomSheet>
  )
}
