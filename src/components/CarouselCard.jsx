import Image from './Image'
import './Carousel.css'

// Tall card used inside Carousel: photo filling the top ~2/3, a charcoal
// footer below with a bold sans label and a serif title — not overlaid text
// on the photo (no scrim needed; the footer sits on its own solid ground,
// same as the reference). `href` renders a real <a> (a trip's /trip/:slug
// link must stay a plain anchor, not client-routed — see main.jsx); omit it
// and pass `onClick` instead for an in-page action like opening the intake
// panel for a brief's city.
export default function CarouselCard({ imageSrc, imageAlt = '', label, title, href, onClick }) {
  const Tag = href ? 'a' : onClick ? 'button' : 'div'
  return (
    <Tag href={href} type={!href && onClick ? 'button' : undefined} className="carousel-card" onClick={onClick}>
      <Image src={imageSrc} alt={imageAlt} aspectRatio="3 / 4" className="carousel-card-image" />
      <div className="carousel-card-footer">
        {label && <span className="carousel-card-label">{label}</span>}
        {title && <span className="carousel-card-title">{title}</span>}
      </div>
    </Tag>
  )
}
