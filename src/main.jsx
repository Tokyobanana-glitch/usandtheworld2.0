import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import TripPage from './TripPage.jsx'
import ExplorePage from './ExplorePage.jsx'
import TripsPage from './TripsPage.jsx'
import Layout from './Layout.jsx'

// /trip/:slug and /explore can both also be full page loads (api/trip-page.js
// and api/explore-page.js serve them, injecting window.__TRIP_DATA__ /
// __EXPLORE_DATA__ before this script runs) — for OG meta tags on a shared
// link and crawlability. These two get different treatment on that path:
//
// /trip/:slug genuinely must render precisely what the server committed to —
// a saved trip is a frozen artifact (see itineraryStore.js's
// getItineraryBySlug), and letting react-router re-render or re-fetch it
// would risk showing something other than what was shared. So when
// window.__TRIP_DATA__ is present, hydrate TripPage directly and never mount
// the router at all — no tab bar, no navigation, exactly as a share link
// should behave.
//
// /explore has no such guarantee — it's a live listing, not a per-user
// artifact — so even a direct load (typed URL, a search result, a plain
// <a href> from elsewhere in the app) mounts the full router + tab-bar
// shell, same as reaching it via the tab. window.__EXPLORE_DATA__, when
// present, is just handed to ExplorePage as its initial state so it never
// re-fetches what the server already sent; reached instead via in-app
// navigation, that data is null and ExplorePage fetches it client-side (see
// ExplorePage.jsx). Either way, the URL is /explore, so react-router's own
// matching renders the right route regardless of which branch got us here.
const tripData = typeof window !== 'undefined' ? window.__TRIP_DATA__ : null
const exploreData = typeof window !== 'undefined' ? window.__EXPLORE_DATA__ : null

function Root() {
  if (tripData) return <TripPage data={tripData} />

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<App />} />
          <Route path="/trips" element={<TripsPage />} />
          <Route path="/explore" element={<ExplorePage data={exploreData} />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)

// Production only — registering a service worker during `vite dev` would
// have it intercept and cache module requests mid-HMR, causing stale-module
// bugs that have nothing to do with the PWA feature itself.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
