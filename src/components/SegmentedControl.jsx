import './SegmentedControl.css'

// The iOS-style rounded track used by Travel (Planned/Watching/Shared with
// me) — a raised pill on the selected segment, distinct from TabStrip
// (Explore's underlined text tabs). Each segment paints its own background
// when active rather than a single sliding pill element — simpler, and
// matches the reference closely enough without position-tracking JS.
export default function SegmentedControl({ segments, activeKey, onChange }) {
  return (
    <div className="segmented-control" role="tablist">
      {segments.map((segment) => (
        <button
          key={segment.key}
          type="button"
          role="tab"
          aria-selected={segment.key === activeKey}
          className={`segmented-control-item${segment.key === activeKey ? ' segmented-control-item--active' : ''}`}
          onClick={() => onChange(segment.key)}
        >
          {segment.label}
        </button>
      ))}
    </div>
  )
}
