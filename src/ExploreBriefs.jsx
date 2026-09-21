import { useEffect, useState } from 'react'
import { getSupabaseClient } from './services/supabaseClient'

// Editorial "why go now" destination briefs — public content, read directly
// through the anon client (RLS grants select to everyone; see
// supabase/006_explore_briefs.sql), generated weekly by
// api/cron/check-watches.js, never per-request. Renders nothing at all —
// not an empty state, not an error, just nothing — when the table doesn't
// exist yet (migration 006 not applied) or holds no rows, so the Explore
// tab looks exactly as it did before this feature shipped until the
// migration runs and the first cron cycle populates it.
export default function ExploreBriefs({ onBuildItinerary }) {
  const [briefs, setBriefs] = useState(null) // null = not loaded yet, distinct from an empty list

  useEffect(() => {
    let cancelled = false
    const supabase = getSupabaseClient()
    if (!supabase) {
      setBriefs([])
      return
    }
    supabase
      .from('explore_briefs')
      .select('*')
      .order('generated_at', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          // Expected until migration 006 is applied — degrade silently,
          // exactly like every other optional-table read in this app.
          setBriefs([])
          return
        }
        setBriefs(data || [])
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!briefs || briefs.length === 0) return null

  return (
    <section className="explore-briefs">
      <div className="explore-briefs-inner">
        <h3 className="discover-feed-title">Why go now</h3>
        <div className="explore-briefs-grid">
          {briefs.map((brief) => (
            <div key={brief.id} className="explore-brief-card">
              <span className="explore-brief-city">{brief.city}</span>
              {brief.country && <span className="explore-brief-country">{brief.country}</span>}
              {brief.why_now && <p className="explore-brief-why">{brief.why_now}</p>}

              {Array.isArray(brief.highlights) && brief.highlights.length > 0 && (
                <ul className="explore-brief-highlights">
                  {brief.highlights.map((h, i) => (
                    <li key={i}>
                      <strong>{h.name}</strong> — {h.line}
                    </li>
                  ))}
                </ul>
              )}

              <div className="explore-brief-meta">
                {brief.best_months && <span className="explore-brief-chip">Best: {brief.best_months}</span>}
                {brief.price_level && <span className="explore-brief-chip">{brief.price_level}</span>}
              </div>

              <button
                type="button"
                className="explore-brief-cta"
                onClick={() => onBuildItinerary(brief.city, brief.country)}
              >
                Build me an itinerary for {brief.city} →
              </button>

              {Array.isArray(brief.sources) && brief.sources.length > 0 && (
                <details className="explore-brief-sources">
                  <summary>Sources</summary>
                  <ul>
                    {brief.sources.map((src, i) => (
                      <li key={i}>
                        <a href={src.url} target="_blank" rel="noopener noreferrer">
                          {src.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
