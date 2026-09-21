import { useState } from 'react'
import { getSupabaseClient } from './services/supabaseClient'
import BottomSheet from './components/BottomSheet'

// Magic link only — no passwords. Triggered by a save action (bucket list,
// passport, claiming a trip) via AuthContext's requestSignIn(). Built on the
// shared BottomSheet shell (see components/BottomSheet.jsx) rather than its
// own overlay/panel markup.
export default function SignInSheet({ onClose }) {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState('idle') // idle | sending | sent | error
  const [error, setError] = useState(null)

  async function handleSubmit(event) {
    event.preventDefault()
    const supabase = getSupabaseClient()
    if (!supabase) {
      setStatus('error')
      setError('Sign-in is temporarily unavailable — please try again in a moment.')
      return
    }

    setStatus('sending')
    setError(null)
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    })

    if (signInError) {
      setStatus('error')
      setError(signInError.message || 'Something went wrong sending your link.')
      return
    }

    setStatus('sent')
  }

  return (
    <BottomSheet title="Sign in" onClose={onClose}>
      {status === 'sent' ? (
        <p className="signin-sent-message">
          Check <strong>{email.trim()}</strong> for a sign-in link. You can close this and keep browsing — it'll sign you in
          as soon as you click it.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="signin-form">
          <p className="signin-intro">No password needed — we'll email you a link to sign in.</p>
          <div className="intake-field">
            <label className="intake-field-label" htmlFor="signin-email">
              Email
            </label>
            <input
              id="signin-email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@email.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="intake-notes-input"
            />
          </div>
          {status === 'error' && <p className="result-error">{error}</p>}
          <button type="submit" className="intake-submit-btn signin-submit-btn" disabled={status === 'sending'}>
            {status === 'sending' ? 'Sending…' : 'Send magic link'}
          </button>
        </form>
      )}
    </BottomSheet>
  )
}
