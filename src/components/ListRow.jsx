import './ListGroup.css'

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// icon: a small SVG/element shown at the row's left. trailing: overrides the
// default chevron — pass null for no trailing content (e.g. a "Sign out"
// action row), or a custom node (e.g. an install-app button state).
// onClick makes the whole row tappable; omit it for a purely informational
// row (still gets the chevron slot unless trailing is overridden, so pass
// trailing={null} explicitly for those too).
export default function ListRow({ icon, label, sublabel, onClick, trailing }) {
  const content = (
    <>
      {icon && <span className="list-row-icon">{icon}</span>}
      <span className="list-row-text">
        <span className="list-row-label">{label}</span>
        {sublabel && <span className="list-row-sublabel">{sublabel}</span>}
      </span>
      <span className="list-row-trailing">{trailing !== undefined ? trailing : <ChevronIcon />}</span>
    </>
  )

  if (onClick) {
    return (
      <button type="button" className="list-row list-row--tappable" onClick={onClick}>
        {content}
      </button>
    )
  }

  return <div className="list-row">{content}</div>
}
