import './TabStrip.css'

// Explore's text-tab row (Featured/Guides/Trending) — distinct from
// SegmentedControl (Travel's pill track): equal-width flex items, each with
// its own bottom border, so the active tab's accent underline naturally
// spans exactly its own share of the width with no position math.
export default function TabStrip({ tabs, activeKey, onChange }) {
  return (
    <div className="tab-strip" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={tab.key === activeKey}
          className={`tab-strip-item${tab.key === activeKey ? ' tab-strip-item--active' : ''}`}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
