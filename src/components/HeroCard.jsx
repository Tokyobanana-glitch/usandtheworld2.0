import Image from './Image'
import './HeroCard.css'

// Full-bleed photo + charcoal band editorial card — Explore's Articles/
// Guides layout in the reference. `label` is the small bold sans line
// ("Guide") shown only when provided; `linkText` renders as an accent text
// link, never a button (per the reference's "tappable is a link, not a
// decorated arrow-suffixed pill").
export default function HeroCard({ imageSrc, imageAlt = '', label, title, byline, excerpt, linkText, onLinkClick, priority = false }) {
  return (
    <article className="hero-card">
      <Image src={imageSrc} alt={imageAlt} aspectRatio="16 / 10" priority={priority} className="hero-card-image" />
      <div className="hero-card-body">
        {label && <span className="hero-card-label">{label}</span>}
        <h2 className="hero-card-title">{title}</h2>
        {byline && <p className="hero-card-byline">{byline}</p>}
        {excerpt && <p className="hero-card-excerpt">{excerpt}</p>}
        {linkText && (
          <button type="button" className="hero-card-link" onClick={onLinkClick}>
            {linkText}
          </button>
        )}
      </div>
    </article>
  )
}
