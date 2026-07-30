import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import TripPage from './TripPage.jsx'

// No router library for one route: /trip/:slug is always a full page load
// (api/trip-page.js serves it, injecting window.__TRIP_DATA__ before this
// script runs), so a simple presence check is enough — there's no client-side
// navigation into this route that would need it re-evaluated.
const tripData = typeof window !== 'undefined' ? window.__TRIP_DATA__ : null

createRoot(document.getElementById('root')).render(
  <StrictMode>{tripData ? <TripPage data={tripData} /> : <App />}</StrictMode>,
)
