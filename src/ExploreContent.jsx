import { useEffect, useState } from 'react'
import { getSupabaseClient } from './services/supabaseClient'
import { curatedHeroUrl, curatedCardUrl, citySlug } from './curatedMedia'
import TabStrip from './components/TabStrip'
import HeroCard from './components/HeroCard'
import Carousel from './components/Carousel'
import CarouselCard from './components/CarouselCard'
import PosterCard from './components/PosterCard'
import './ExploreContent.css'

const EXPLORE_TABS = [
  { key: 'featured', label: 'Featured' },
  { key: 'guides', label: 'Guides' },
  { key: 'trending', label: 'Trending' },
]

// Below MIN_TRIPS_TO_SHOW, a "recently verified" carousel would read as
// obviously thin — same call DiscoverFeed.jsx already makes for its own
// verified-trips strip.
const MIN_TRIPS_TO_SHOW = 3
const CAROUSEL_TRIP_LIMIT = 8

function GuideCard({ brief, onBuildItinerary }) {
  return (
    <article className="guide-card">
      <HeroCard
        imageSrc={curatedHeroUrl(citySlug(brief.city))}
        imageAlt={brief.city}
        label="Guide"
        title={brief.city}
        excerpt={brief.why_now}
        linkText="Build this trip"
        onLinkClick={() => onBuildItinerary(brief.city, brief.country)}
      />
      <div className="guide-card-extra">
        {Array.isArray(brief.highlights) && brief.highlights.length > 0 && (
          <ul className="guide-highlights">
            {brief.highlights.map((h, i) => (
              <li key={i}>
                <strong>{h.name}</strong> — {h.line}
              </li>
            ))}
          </ul>
        )}
        {(brief.best_months || brief.price_level) && (
          <div className="guide-meta">
            {brief.best_months && <span className="guide-chip">Best: {brief.best_months}</span>}
            {brief.price_level && <span className="guide-chip">{brief.price_level}</span>}
          </div>
        )}
        {Array.isArray(brief.sources) && brief.sources.length > 0 && (
          <details className="guide-sources">
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
    </article>
  )
}

// Explore's Featured/Guides/Trending tabs, per
// design-reference/DESIGN_REFERENCE.md's Explore section — built entirely
// on explore_briefs (editorial "why go now" city briefs) plus the same
// recently-verified-trips feed DiscoverFeed.jsx already draws on. Renders
// nothing at all — not an empty state — until explore_briefs has rows,
// same degrade-silently convention the ExploreBriefs.jsx section this
// replaces used (missing migration, or not seeded yet — see
// scripts/seed-briefs.mjs).
export default function ExploreContent({ onBuildItinerary }) {
  const [activeTab, setActiveTab] = useState('featured')
  const [briefs, setBriefs] = useState(null) // null = not loaded yet, distinct from an empty list
  const [trips, setTrips] = useState(null)

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
      .order('city', { ascending: true })
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

  useEffect(() => {
    let cancelled = false
    fetch('/api/explore-data')
      .then((res) => res.json())
      .then((body) => {
        if (!cancelled) setTrips(body.trips || [])
      })
      .catch(() => {
        if (!cancelled) setTrips([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!briefs || briefs.length === 0) return null

  // "Lead" brief for the Featured hero — most recently generated, so the
  // one thing most likely to still be current is what a visitor sees first.
  const leadBrief = [...briefs].sort((a, b) => new Date(b.generated_at) - new Date(a.generated_at))[0]
  const restBriefs = briefs.filter((b) => b.id !== leadBrief.id)
  const showTrips = trips && trips.length >= MIN_TRIPS_TO_SHOW

  return (
    <section className="explore-tabs">
      <TabStrip tabs={EXPLORE_TABS} activeKey={activeTab} onChange={setActiveTab} />

      {activeTab === 'featured' && (
        <div className="explore-tab-panel">
          <HeroCard
            imageSrc={curatedHeroUrl(citySlug(leadBrief.city))}
            imageAlt={leadBrief.city}
            title={leadBrief.city}
            excerpt={leadBrief.why_now}
            linkText="Build this trip"
            onLinkClick={() => onBuildItinerary(leadBrief.city, leadBrief.country)}
            priority
          />

          {restBriefs.length > 0 && (
            <div className="explore-section">
              <div className="explore-section-header">
                <h3 className="explore-section-heading">Editor's picks</h3>
                <p className="explore-section-subtitle">More cities worth a look right now.</p>
              </div>
              <Carousel variant="centered" ariaLabel="Editor's picks">
                {restBriefs.map((brief) => (
                  <CarouselCard
                    key={brief.id}
                    imageSrc={curatedCardUrl(citySlug(brief.city))}
                    imageAlt={brief.city}
                    label="Guide"
                    title={brief.city}
                    onClick={() => onBuildItinerary(brief.city, brief.country)}
                  />
                ))}
              </Carousel>
            </div>
          )}

          {showTrips && (
            <div className="explore-section">
              <div className="explore-section-header">
                <h3 className="explore-section-heading">Recently verified</h3>
                <p className="explore-section-subtitle">Real itineraries, checked against live sources.</p>
              </div>
              <Carousel variant="centered" ariaLabel="Recently verified trips">
                {trips.slice(0, CAROUSEL_TRIP_LIMIT).map((trip) => (
                  <CarouselCard
                    key={trip.slug}
                    href={`/trip/${trip.slug}`}
                    imageSrc={trip.destinationImage?.url}
                    imageAlt={trip.destination}
                    label="Verified"
                    title={trip.destination}
                  />
                ))}
              </Carousel>
              <a href="/explore" className="explore-section-see-all">
                See all verified trips →
              </a>
            </div>
          )}
        </div>
      )}

      {activeTab === 'guides' && (
        <div className="explore-tab-panel guide-feed">
          {briefs.map((brief) => (
            <GuideCard key={brief.id} brief={brief} onBuildItinerary={onBuildItinerary} />
          ))}
        </div>
      )}

      {activeTab === 'trending' && (
        <div className="explore-trending-panel">
          <Carousel variant="full-bleed" ariaLabel="Trending destinations">
            {briefs.map((brief) => (
              <PosterCard
                key={brief.id}
                imageSrc={curatedCardUrl(citySlug(brief.city))}
                imageAlt={brief.city}
                location={brief.country ? `${brief.city}, ${brief.country}` : brief.city}
                onClick={() => onBuildItinerary(brief.city, brief.country)}
              />
            ))}
          </Carousel>
        </div>
      )}
    </section>
  )
}
