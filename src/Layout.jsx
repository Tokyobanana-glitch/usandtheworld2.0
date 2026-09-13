import { Outlet } from 'react-router-dom'
import TabBar from './TabBar'

// Wraps every client-routed tab (Discover, Trips, Explore) with the bottom
// tab bar. Deliberately NOT used by /trip/:slug (rendered directly by
// main.jsx's SSR-hydration branch) — a trip page is a drill-in destination
// reached from Trips/Explore, not a tab itself, and keeping it outside this
// shell keeps its (already careful) frozen-share-link rendering untouched.
export default function Layout() {
  return (
    <div className="app-shell">
      <Outlet />
      <TabBar />
    </div>
  )
}
