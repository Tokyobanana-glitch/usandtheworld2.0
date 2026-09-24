import Image from './Image'
import './PosterCard.css'

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="currentColor" />
      <circle cx="12" cy="9" r="2.4" fill="var(--color-page-bg)" />
    </svg>
  )
}

// Full-bleed poster with a location pill bottom-left over a gradient scrim —
// Explore's Trending tab, per the reference's Trends poster
// (`03-inspiration-trends.jpg`): one destination fills the whole card,
// tappable as a whole. Meant to sit inside Carousel variant="full-bleed",
// which already gives it the edge-to-edge, one-per-swipe layout.
export default function PosterCard({ imageSrc, imageAlt = '', location, onClick }) {
  return (
    <button type="button" className="poster-card" onClick={onClick}>
      <Image src={imageSrc} alt={imageAlt} aspectRatio="3 / 4" className="poster-card-image" priority={false} />
      <div className="poster-card-scrim" aria-hidden="true" />
      {location && (
        <span className="poster-card-pill">
          <PinIcon />
          {location}
        </span>
      )}
    </button>
  )
}
