import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import TripPage from './TripPage.jsx'
import ExplorePage from './ExplorePage.jsx'

// No router library for these routes: /trip/:slug and /explore are always a
// full page load (api/trip-page.js and api/explore-page.js serve them,
// injecting window.__TRIP_DATA__ / window.__EXPLORE_DATA__ before this
// script runs), so a simple presence check is enough — there's no
// client-side navigation into either route that would need it re-evaluated.
const tripData = typeof window !== 'undefined' ? window.__TRIP_DATA__ : null
const exploreData = typeof window !== 'undefined' ? window.__EXPLORE_DATA__ : null

function Root() {
  if (tripData) return <TripPage data={tripData} />
  if (exploreData) return <ExplorePage data={exploreData} />
  return <App />
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
