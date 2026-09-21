import { useState } from 'react'
import './Image.css'

// Generic image primitive every card/hero component builds on: reserves
// space via aspectRatio (no layout shift, before or after the image ever
// loads), shows a dark placeholder until it does, and falls back to that
// same placeholder — never a broken-image icon — if src 404s or is absent
// entirely. `priority` opts a single above-the-fold image (a hero) out of
// native lazy loading; everything else defaults to lazy.
export default function Image({ src, alt = '', aspectRatio, className = '', priority = false, style }) {
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const showImage = src && !failed

  return (
    <span
      className={`ut-image${loaded && showImage ? ' ut-image--loaded' : ''} ${className}`}
      style={{ aspectRatio, ...style }}
    >
      {showImage && (
        <img
          src={src}
          alt={alt}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      )}
    </span>
  )
}
