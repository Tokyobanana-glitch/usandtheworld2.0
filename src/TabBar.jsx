import { NavLink } from 'react-router-dom'
import './TabBar.css'

// Filled, slightly illustrative icons per design-reference/DESIGN_REFERENCE.md
// ("Amex's icons are filled and slightly illustrative, not thin outlines")
// — single solid paths rather than the previous stroke-only outlines.
// PassportIcon's "photo" dot is cut out in the tab bar's own background
// color (--color-card-bg), not transparency, so it reads correctly
// regardless of what's behind the bar.
function CompassIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      <path
        d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z"
        fill="currentColor"
      />
    </svg>
  )
}

function HeartIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      <path
        d="M12 20.5s-7.5-4.6-9.9-9.3C.6 8 2.1 4.8 5.4 4.1c2-.4 4 .5 5.1 2.2a5 5 0 0 1 1.5 0C13.1 4.6 15.1 3.7 17.1 4.1c3.3.7 4.8 3.9 3.3 7.1-2.4 4.7-9.9 9.3-9.9 9.3z"
        fill="currentColor"
      />
    </svg>
  )
}

function PassportIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      <rect x="5" y="2.5" width="14" height="19" rx="2.5" fill="currentColor" />
      <circle cx="12" cy="9.5" r="2.2" fill="var(--color-card-bg)" />
      <path d="M8.4 16.5c.7-1.8 2-2.7 3.6-2.7s2.9.9 3.6 2.7" stroke="var(--color-card-bg)" strokeWidth="1.6" strokeLinecap="round" fill="none" />
    </svg>
  )
}

function BookmarkIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      <path d="M6.5 4h11a1 1 0 0 1 1 1v15l-6.5-3.6L5.5 20V5a1 1 0 0 1 1-1z" fill="currentColor" />
    </svg>
  )
}

// "Explore" now covers the search-hero + inspiration-feed landing (see
// App.jsx) — the standalone verified-trips grid that used to be the
// "Explore" tab still lives at the /explore URL (unchanged, still SSR'd —
// see api/explore-page.js and vercel.json) but no longer has a dedicated
// tab button, since that name/slot now belongs to this broader landing
// page. It's still reachable via "See all verified trips" links and by
// direct URL; the tab bar just won't highlight anything while on it.
export const TABS = [
  { to: '/', label: 'Explore', Icon: CompassIcon, end: true },
  { to: '/bucket-list', label: 'Bucket List', Icon: HeartIcon },
  { to: '/passport', label: 'Passport', Icon: PassportIcon },
  { to: '/trips', label: 'Travel', Icon: BookmarkIcon },
]

// Fixed to the bottom on mobile (hidden above the desktop breakpoint, where
// TopNav takes over — see App.css's .tab-bar media query and TopNav.jsx);
// only ever mounted inside the client-routed branch of main.jsx, never in
// the SSR-hydrated /trip/:slug or direct-load /explore branches, so it's
// always safe to use router hooks here.
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
