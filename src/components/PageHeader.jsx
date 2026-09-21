import { useAuth } from '../AuthContext'
import './PageHeader.css'

function ProfileIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      <circle cx="12" cy="8.5" r="4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4.5 20c1.4-3.8 4.4-5.8 7.5-5.8s6.1 2 7.5 5.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

// Two variants from design-reference/DESIGN_REFERENCE.md:
// "large" — left-aligned bold sans title, generous space above — for Bucket
// List, Passport, Travel.
// "centered" — small centered title — for Explore, which pairs it with
// TabStrip directly beneath (composed by the caller, not by PageHeader
// itself, since Explore's title slot is the existing search hero, not this
// component — see the reference's Explore section).
// A profile icon sits top-right in both variants, wired straight to
// AuthContext's requestProfile() so no caller has to prop-drill it.
export default function PageHeader({ variant = 'large', title }) {
  const { requestProfile } = useAuth()

  return (
    <header className={`page-header page-header--${variant}`}>
      {variant === 'large' ? <h1 className="page-header-title">{title}</h1> : <span className="page-header-title">{title}</span>}
      <button type="button" className="page-header-profile" onClick={requestProfile} aria-label="Open profile">
        <ProfileIcon />
      </button>
    </header>
  )
}
