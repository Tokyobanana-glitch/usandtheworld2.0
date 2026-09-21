import Image from './Image'
import './Carousel.css'

// Tall card used inside Carousel: photo filling the top ~2/3, a charcoal
// footer below with a bold sans label and a serif title — not overlaid text
// on the photo (no scrim needed; the footer sits on its own solid ground,
// same as the reference).
export default function CarouselCard({ imageSrc, imageAlt = '', label, title, onClick }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag type={onClick ? 'button' : undefined} className="carousel-card" onClick={onClick}>
      <Image src={imageSrc} alt={imageAlt} aspectRatio="3 / 4" className="carousel-card-image" />
      <div className="carousel-card-footer">
        {label && <span className="carousel-card-label">{label}</span>}
        {title && <span className="carousel-card-title">{title}</span>}
      </div>
    </Tag>
  )
}
