import { NavLink } from 'react-router-dom'

function CompassIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M15 9l-2 5-5 2 2-5z" fill="currentColor" />
    </svg>
  )
}

function BookmarkIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        d="M6.5 4h11a1 1 0 0 1 1 1v15l-6.5-3.6L5.5 20V5a1 1 0 0 1 1-1z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <ellipse cx="12" cy="12" rx="4" ry="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <line x1="3" y1="12" x2="21" y2="12" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  )
}

const TABS = [
  { to: '/', label: 'Discover', Icon: CompassIcon, end: true },
  { to: '/trips', label: 'Trips', Icon: BookmarkIcon },
  { to: '/explore', label: 'Explore', Icon: GlobeIcon },
]

// Fixed to the bottom on mobile (hidden above the desktop breakpoint — see
// .tab-bar in App.css); only ever mounted inside the client-routed branch of
// main.jsx, never in the SSR-hydrated /trip/:slug or direct-load /explore
// branches, so it's always safe to use router hooks here.
export default function TabBar() {
  return (
    <nav className="tab-bar" aria-label="Main navigation">
      {TABS.map(({ to, label, Icon, end }) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => `tab-bar-item${isActive ? ' tab-bar-item--active' : ''}`}>
          <Icon />
          <span className="tab-bar-label">{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
