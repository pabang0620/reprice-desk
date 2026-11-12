import { createWidgets } from 'ag-studio-react'
import StrategyCompare from '../widgets/StrategyCompare.jsx'
import RepriceApprovalCard from '../widgets/RepriceApprovalCard.jsx'
import PriceLadder from '../widgets/PriceLadder.jsx'
import NoticeWindowStrip from '../widgets/NoticeWindowStrip.jsx'
import NextSteps from '../widgets/NextSteps.jsx'
import { createCellRenderer } from './cellRenderers.jsx'

const mapItem = (type, role, aiDescription) => ({ type, supportedRoles: [role], required: true, aiDescription })

// Data mapping per widget: the fields it reads from the Studio data engine. Empty for widgets that only show app state.
export const DATA_MAPPINGS = {
  priceLadder: {
    member: mapItem('field', 'category', 'Member label, one line per member.'),
    strategy: mapItem('field', 'category', 'Strategy A or B.'),
    month: mapItem('field', 'category', 'Month of the timeline.'),
    cohort: mapItem('field', 'category', 'kept or raised.'),
    price: mapItem('field', 'numeric', 'Price paid in that month.'),
  },
  noticeWindowStrip: {
    member: mapItem('field', 'category', 'Member label, one bar per member.'),
    days: mapItem('field', 'numeric', 'Days from today to the next charge.'),
    cohort: mapItem('field', 'category', 'Kept or Raised.'),
  },
}

const LABELS = { member: 'Member', strategy: 'Strategy', month: 'Month', cohort: 'Cohort', price: 'Price', days: 'Days to charge' }

function definition({ id, label, comp, width, height, ai }) {
  const mapping = DATA_MAPPINGS[id] || {}
  return {
    id,
    label,
    comp,
    dataMapping: mapping,
    form: ({ createDefaults }) => createDefaults({ dataMappingItems: Object.keys(mapping).map((key) => ({ key, label: LABELS[key] || key })) }),
    defaultState: { dataMapping: {} },
    defaultSize: { width, height },
    minSize: { width: 6, height: 8 },
    ai,
  }
}

export const customWidgets = [
  definition({ id: 'strategyCompare', label: 'Strategy compare', comp: StrategyCompare, width: 14, height: 26, ai: { label: 'Strategy compare', description: 'Side-by-side metrics for strategy A and B, computed by code.', usage: 'Use when the operator asks which way to raise prices.' } }),
  definition({ id: 'priceLadder', label: 'Price ladder', comp: PriceLadder, width: 12, height: 18, ai: { label: 'Price ladder', description: 'Per-member price over the next 13 months as flat or stepped lines.', usage: 'Use to show when each cohort pays a new price.' } }),
  definition({ id: 'noticeWindowStrip', label: 'Notice window strip', comp: NoticeWindowStrip, width: 12, height: 18, ai: { label: 'Notice window strip', description: 'Days from today to each next charge with PayPal 10-day zone and the chosen notice window.', usage: 'Use to explain timing and the ten-day rule.' } }),
  definition({ id: 'repriceApprovalCard', label: 'Approval card', comp: RepriceApprovalCard, width: 10, height: 26, ai: { label: 'Approval card', description: 'Operator price inputs, the frozen plan and the Approve & run button.', usage: 'The only place prices are entered and money-moving steps are approved.' } }),
  definition({ id: 'nextSteps', label: 'Next steps', comp: NextSteps, width: 10, height: 22, ai: { label: 'Next steps', description: 'Read-back result, new plan IDs, scheduled raises and notice CSV export.', usage: 'Use after a run.' } }),
]

export const widgetsConfig = createWidgets({
  additionalTypes: customWidgets,
  menu: [{ label: 'Reprice Desk', widgetIds: customWidgets.map((w) => w.id) }],
  // Members and Run log grids: Kept and Overridden as badges, times as HH:MM:SS.
  overrides: [{ id: 'grid', options: { createCellRenderer } }],
})
