import './ListGroup.css'

// Rounded charcoal container of ListRows — Profile's grouped-rows pattern.
// Hairline dividers between rows come from ListRow's own border, inset by
// its content padding so it doesn't run under the icon; the last row's
// divider is suppressed via :last-child in CSS, not a prop.
export default function ListGroup({ children }) {
  return <div className="list-group">{children}</div>
}
