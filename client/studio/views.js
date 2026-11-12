const widget = (type, extra = {}) => ({ type, dataMapping: {}, ...extra })
const layout = (xTrack, yTrack, xSpan, ySpan) => ({ xTrack, yTrack, xSpan, ySpan })
// Field ids are table-qualified: <source>.<field>.
const ref = (table) => (id) => ({ id: `${table}.${id}` })

const PANELS = { filters: { collapsed: true }, edit: { collapsed: true }, data: { collapsed: true }, ai: { collapsed: false, width: 340 } }

const mapped = (table, keys) => Object.fromEntries(Object.entries(keys).map(([key, field]) => [key, [ref(table)(field)]]))
const ladder = () => widget('priceLadder', { dataMapping: mapped('price_timeline', { member: 'member', strategy: 'strategy', month: 'month', cohort: 'cohort', price: 'price' }) })
const strip = () => widget('noticeWindowStrip', { dataMapping: mapped('subscribers', { member: 'member', days: 'days_to_charge', cohort: 'cohort' }) })

const memberGrid = (...cols) => widget('grid', { dataMapping: { cols: cols.map(ref('subscribers')) }, format: { title: { text: 'Members', enabled: true } } })

// The Compare view: decide. Saved views the operator makes with the layout tools replace these presets.
export function compareState() {
  return {
    selectedPageId: 'compare',
    panels: PANELS,
    pages: [{
      id: 'compare',
      widgets: {
        strategyCompare: widget('strategyCompare'),
        approval: widget('repriceApprovalCard'),
        ladder: ladder(),
        notice: strip(),
        members: memberGrid('member', 'plan', 'tag', 'signup_month', 'source', 'price', 'overridden', 'next_charge', 'days_to_charge', 'derived_next_charge', 'cohort'),
      },
      widgetLayout: {
        strategyCompare: layout(0, 0, 13, 34),
        approval: layout(13, 0, 11, 34),
        ladder: layout(0, 34, 12, 17),
        notice: layout(12, 34, 12, 17),
        members: layout(0, 51, 24, 18),
      },
    }],
  }
}

// The Execution view: what ran, what PayPal returned, what comes next.
export function executionState() {
  return {
    selectedPageId: 'execution',
    panels: PANELS,
    pages: [{
      id: 'execution',
      widgets: {
        nextSteps: widget('nextSteps'),
        ladder: ladder(),
        events: widget('grid', { dataMapping: { cols: ['at', 'kind', 'detail'].map(ref('events')) }, format: { title: { text: 'Run log and webhooks', enabled: true } } }),
        members: memberGrid('member', 'cycle', 'price', 'overridden', 'derived_next_charge', 'cohort'),
      },
      widgetLayout: {
        nextSteps: layout(0, 0, 10, 28),
        ladder: layout(10, 0, 14, 28),
        events: layout(0, 28, 12, 18),
        members: layout(12, 28, 12, 18),
      },
    }],
  }
}

const KEY = 'reprice-desk.views.v2'

export function loadSavedView(name) {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}')[name] || null
  } catch {
    return null
  }
}

export function saveView(name, state) {
  const all = JSON.parse(localStorage.getItem(KEY) || '{}')
  localStorage.setItem(KEY, JSON.stringify({ ...all, [name]: state }))
}
