import { Outlet } from 'react-router-dom'
import TabBar from './TabBar'
import TopNav from './components/TopNav'
import './Layout.css'

// Wraps every client-routed tab (Explore, Bucket List, Passport, Travel)
// with navigation: TabBar fixed to the bottom on mobile, TopNav sticky to
// the top on desktop (768px+) — see each component's own CSS for exactly
// where they hand off. Deliberately NOT used by /trip/:slug (rendered
// directly by main.jsx's SSR-hydration branch) — a trip page is a drill-in
// destination reached from Travel/Explore, not a tab itself, and keeping it
// outside this shell keeps its (already careful) frozen-share-link
// rendering untouched.
export default function Layout() {
  return (
    <div className="app-shell">
      <TopNav />
      <Outlet />
      <TabBar />
    </div>
  )
}
