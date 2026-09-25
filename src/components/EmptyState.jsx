import { useState } from 'react'
import './EmptyState.css'

// Illustration, title, one line, one CTA — the reference's Wishlists/Trips
// empty states, generalized. ctaVariant "button" (Wishlists: full-width
// primary button) or "link" (Trips: plain accent text link) — the reference
// uses both, on purpose, not interchangeably. `card` wraps the whole thing
// in the rounded charcoal card the Wishlists empty state uses; Trips'
// version sits bare on the page background instead — also per the
// reference, not a simplification.
export default function EmptyState({ illustrationSrc, title, description, ctaLabel, onCtaClick, ctaVariant = 'button', card = false }) {
  const [illustrationFailed, setIllustrationFailed] = useState(false)

  return (
    <div className={`empty-state${card ? ' empty-state--card' : ''}`}>
      {/* onError hides a missing illustration entirely rather than leaving a
          broken-image icon — same graceful-degrade convention Image.jsx uses
          elsewhere. Needed today for Travel's travel-empty.png, which
          doesn't exist yet (see CLAUDE.md's imagery note): the layout still
          reads as an intentional, illustration-less empty state instead of
          a broken one. */}
      {illustrationSrc && !illustrationFailed && (
        <img src={illustrationSrc} alt="" className="empty-state-illustration" onError={() => setIllustrationFailed(true)} />
      )}
      <p className="empty-state-title">{title}</p>
      {description && <p className="empty-state-description">{description}</p>}
      {ctaLabel &&
        (ctaVariant === 'link' ? (
          <button type="button" className="empty-state-cta-link" onClick={onCtaClick}>
            {ctaLabel}
          </button>
        ) : (
          <button type="button" className="empty-state-cta-btn" onClick={onCtaClick}>
            {ctaLabel}
          </button>
        ))}
    </div>
  )
}
