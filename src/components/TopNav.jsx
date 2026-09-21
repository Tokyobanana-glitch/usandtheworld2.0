import { NavLink, Link } from 'react-router-dom'
import { useAuth } from '../AuthContext'
import { TABS } from '../TabBar'
import './TopNav.css'

function ProfileIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <circle cx="12" cy="8.5" r="4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4.5 20c1.4-3.8 4.4-5.8 7.5-5.8s6.1 2 7.5 5.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

// Desktop (768px+) counterpart to the mobile TabBar — same 4 destinations
// (reuses TabBar's own TABS list so the two can't drift apart), plus the
// profile icon the reference puts top-right on every tab. Before this, the
// tab bar simply hid itself above the breakpoint with no replacement,
// leaving Bucket List/Passport/Travel unreachable on a laptop.
export default function TopNav() {
  const { requestProfile } = useAuth()

  return (
    <nav className="top-nav" aria-label="Main navigation">
      <Link to="/" className="top-nav-brand">
        Us and The World
      </Link>
      <div className="top-nav-links">
        {TABS.map(({ to, label, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `top-nav-link${isActive ? ' top-nav-link--active' : ''}`}>
            {label}
          </NavLink>
        ))}
      </div>
      <button type="button" className="top-nav-profile" onClick={requestProfile} aria-label="Open profile">
        <ProfileIcon />
      </button>
    </nav>
  )
}
