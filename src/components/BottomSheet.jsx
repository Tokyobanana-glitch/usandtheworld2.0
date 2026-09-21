import './BottomSheet.css'

// Generalized from the pre-redesign SignInSheet/IntakePanel overlay pattern
// (App.css's .intake-overlay/.intake-panel) into a reusable shell — those
// two keep their own markup for this pass (out of scope: they're existing
// tab-content-adjacent flows, not shell), but new sheets (Profile) build on
// this instead of copy-pasting the overlay/panel/header boilerplate again.
// size "auto" is the bottom-sheet-on-mobile/centered-card-on-desktop
// behavior the existing sheets use; "full" is a full-screen takeover
// (Profile, per the reference) with no backdrop card treatment.
export default function BottomSheet({ title, onClose, children, footer, size = 'auto' }) {
  return (
    <div className="bottom-sheet-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`bottom-sheet-panel bottom-sheet-panel--${size}`}>
        <div className="bottom-sheet-header">
          <h2 className="bottom-sheet-title">{title}</h2>
          <button type="button" className="bottom-sheet-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="bottom-sheet-body">{children}</div>
        {footer && <div className="bottom-sheet-footer">{footer}</div>}
      </div>
    </div>
  )
}
