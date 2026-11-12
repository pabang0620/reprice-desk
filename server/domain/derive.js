import { addMonths, daysBetween, iso, monthKey, startOfDay } from './dates.js'
import { monthlyCents } from './money.js'
import { tenDayRuleApplies } from './strategy.js'

// PayPal has no "next charge amount" field, so the desk derives it and labels it "derived":
// 1) the subscription's own override, 2) the plan's current price, 3) the ten day rule for a recent change.
export function deriveNextCharge({ overridden, overridePriceCents, planPriceCents, change = null, nextBillingTime, fundedBy = 'PAYPAL' }) {
  const source = overridden ? 'override' : 'plan'
  const current = overridden ? overridePriceCents : planPriceCents
  if (change) {
    const daysFromChange = daysBetween(change.changedAt, nextBillingTime)
    if (tenDayRuleApplies({ kind: change.kind, fundedBy, daysUntilCharge: daysFromChange })) {
      return { amountCents: change.previousCents, source, tenDayApplied: true }
    }
  }
  return { amountCents: current, source, tenDayApplied: false }
}

// Price per month for each subscription, per strategy. The first charge at the new price comes from the plan.
export function buildTimeline({ subs, strategyPlan, now, months = 13 }) {
  const rows = []
  const today = startOfDay(now)
  for (const sub of subs) {
    const decision = strategyPlan.perSub[sub.id]
    const raiseAt = decision && ['raise_plan', 'raise_now', 'raise_scheduled', 'protect_then_raise', 'outside_window'].includes(decision.action)
      ? decision.firstChargeDays
      : null
    for (let m = 0; m < months; m += 1) {
      const date = addMonths(today, m)
      const days = daysBetween(today, date)
      const raised = raiseAt != null && days >= raiseAt
      rows.push({
        subscription: sub.label,
        strategy: strategyPlan.strategy,
        month: monthKey(date),
        date: iso(date),
        cohort: decision && decision.action !== 'keep' && decision.action !== 'keep_override' && decision.action !== 'blocked' ? 'raised' : 'kept',
        priceCents: raised ? decision.targetCents : sub.priceCents,
        daysFromToday: days,
      })
    }
  }
  return rows
}

export function projectRevenue({ subs, timeline }) {
  const byId = new Map(subs.map((s) => [s.label, s]))
  const buckets = new Map()
  for (const row of timeline) {
    const key = `${row.strategy}|${row.month}`
    const sub = byId.get(row.subscription)
    buckets.set(key, (buckets.get(key) || 0) + monthlyCents(row.priceCents, sub.interval))
  }
  return [...buckets.entries()].map(([key, cents]) => {
    const [strategy, month] = key.split('|')
    return { strategy, month, mrrCents: Math.round(cents) }
  })
}

