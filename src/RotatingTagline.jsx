import { useEffect, useRef, useState } from 'react'

const LINES = [
  "AI tools often repeat whatever's most talked about online, not what's actually true.",
  'Skip the research. Get answers checked as of today, not sometime last year.',
  "Save a trip and we keep watching it. If a place closes before you go, we'll update your plan.",
  "Discover your next adventure, and trust it's still true when you get there.",
]

const LINE_DURATION_MS = 5000
const CROSSFADE_MS = 600

export default function RotatingTagline() {
  const [reducedMotion] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  )
  const [slotContent, setSlotContent] = useState([LINES[0], LINES[1]])
  const [frontSlot, setFrontSlot] = useState(0)
  const nextLineRef = useRef(2 % LINES.length)

  useEffect(() => {
    if (reducedMotion) return

    const swap = setInterval(() => {
      setFrontSlot((prev) => (prev === 0 ? 1 : 0))
    }, LINE_DURATION_MS)

    return () => clearInterval(swap)
  }, [reducedMotion])

  useEffect(() => {
    if (reducedMotion) return

    const backSlot = frontSlot === 0 ? 1 : 0
    const loadNext = setTimeout(() => {
      setSlotContent((prev) => {
        const updated = [...prev]
        updated[backSlot] = LINES[nextLineRef.current]
        return updated
      })
      nextLineRef.current = (nextLineRef.current + 1) % LINES.length
    }, CROSSFADE_MS)

    return () => clearTimeout(loadNext)
  }, [frontSlot, reducedMotion])

  if (reducedMotion) {
    return <p className="rotating-tagline rotating-tagline-static">{LINES[0]}</p>
  }

  return (
    <div className="rotating-tagline">
      {slotContent.map((text, i) => (
        <p
          key={i}
          className={i === 0 ? 'rotating-tagline-line' : 'rotating-tagline-line rotating-tagline-line-overlay'}
          style={{ opacity: i === frontSlot ? 1 : 0 }}
        >
          {text}
        </p>
      ))}
    </div>
  )
}
