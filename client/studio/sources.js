// AG Studio data sources. Fields are declared so the schema exists even before a plan has rows.
const text = (id, name) => ({ id, name, format: 'textFormat' })
const money = (id, name) => ({ id, name, format: 'currencyFormat', formatOptions: { format: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }) } })
const int = (id, name) => ({ id, name, format: 'integerFormat' })

export const SOURCE_FIELDS = {
  subscribers: [text('member', 'Member'), text('plan', 'Plan'), text('cycle', 'Cycle'), text('tag', 'Tag'), text('signup_month', 'Signup month'), text('source', 'Source'), money('price', 'Price'), text('overridden', 'Override'), text('next_charge', 'Next charge'), int('days_to_charge', 'Days to charge'), money('derived_next_charge', 'Derived next charge'), text('ten_day_applied', 'Ten-day rule applied'), text('cohort', 'Cohort')],
  plans: [text('plan', 'Plan'), text('plan_id', 'Plan ID'), int('version', 'Version'), money('price', 'Price'), text('changed_at', 'Changed at')],
  strategy_outcomes: [text('strategy', 'Strategy'), text('metric', 'Metric'), { id: 'value', name: 'Value', format: 'decimalFormat' }],
  price_timeline: [text('member', 'Member'), text('strategy', 'Strategy'), text('month', 'Month'), text('cohort', 'Cohort'), money('price', 'Price')],
  projected_revenue: [text('strategy', 'Strategy'), text('month', 'Month'), money('mrr', 'MRR')],
  events: [text('at', 'Time'), text('kind', 'Kind'), text('detail', 'Detail')],
}

export function buildSources(studio) {
  return Object.keys(SOURCE_FIELDS).map((id) => ({ id, name: id.replaceAll('_', ' '), data: studio[id] || [], fields: SOURCE_FIELDS[id] }))
}
