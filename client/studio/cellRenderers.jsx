import { clockTime } from './clockTime.js'

// Cell renderers for the built-in grid widget (Members and Run log). Chosen by the field id of the column.
function CohortBadge({ value }) {
  const raised = value === 'Raised'
  if (value !== 'Kept' && !raised) return <span className="rd-foot">{value}</span>
  return <span className={raised ? 'rd-badge rd-badge-amber' : 'rd-badge rd-badge-mint'}>{value}</span>
}

function OverriddenBadge({ value }) {
  return value === 'yes' ? <span className="rd-badge rd-badge-pin" title="This subscription carries its own price">Pinned</span> : <span className="rd-foot">-</span>
}

function TimeCell({ value }) {
  return <span className="rd-mono">{clockTime(value)}</span>
}

const RENDERERS = { 'subscribers.cohort': CohortBadge, 'subscribers.overridden': OverriddenBadge, 'events.at': TimeCell }

export function createCellRenderer(field) {
  const id = field?.fieldId ?? field?.id ?? ''
  return RENDERERS[String(id)]
}
