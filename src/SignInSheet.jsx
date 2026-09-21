import { useState } from 'react'
import { getSupabaseClient } from './services/supabaseClient'

// Magic link only — no passwords. Triggered by a future save action (bucket
// list, passport, claiming a trip), never a wall in front of search or
// itinerary generation, which stay fully anonymous regardless of auth
// state. Nothing in this pass calls requestSignIn() yet: Bucket List and
// Passport don't have UI in this pass, and there's no other legitimate
// "save" gesture in the app today to hang it off of — see AuthContext.jsx.
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
    <div className="intake-overlay" role="dialog" aria-modal="true" aria-label="Sign in">
      <div className="intake-panel signin-panel">
        <div className="intake-panel-header">
          <h2>Sign in</h2>
          <button type="button" className="intake-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="intake-panel-body">
          {status === 'sent' ? (
            <p className="signin-sent-message">
              Check <strong>{email.trim()}</strong> for a sign-in link. You can close this and keep browsing — it'll sign you
              in as soon as you click it.
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
        </div>
      </div>
    </div>
  )
}
