import './Carousel.css'

// Two styles from the reference: "centered" (Editor's Picks — an ~85%-width
// active card with peeks on both sides) and "left-aligned" (Wishlists'
// inspiration strip — flush with the page margin, peeking only on the
// right). Native scroll-snap, no JS position tracking. overflow-x is the
// only overflow set — overflow-y stays visible and touch-action is left at
// its default, so a vertical swipe that starts over the carousel still
// scrolls the page; only a horizontal swipe scrolls the carousel. Never set
// touch-action: pan-x here, that's what traps vertical scroll.
export default function Carousel({ variant = 'centered', children, ariaLabel }) {
  return (
    <div className={`carousel carousel--${variant}`} role="region" aria-label={ariaLabel}>
      <div className="carousel-track">{children}</div>
    </div>
  )
}
