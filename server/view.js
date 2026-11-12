import { cohortReport, intentFromRule } from './domain/cohort.js'
import { buildTimeline, deriveNextCharge, projectRevenue } from './domain/derive.js'
import { iso } from './domain/dates.js'
import { fmt, fmtDelta, toValue } from './domain/money.js'
import { compareStrategies } from './domain/strategy.js'

export const DEFAULT_RECOMMENDATION = 'B'

export function strategyInput({ session, snapshot, now, settings }) {
  const intent = session.rule ? intentFromRule(session.rule, snapshot.subs) : null
  if (!intent) return null
  return {
    subs: snapshot.subs,
    intent,
    prices: { MONTH: session.inputs.monthlyCents, YEAR: session.inputs.annualCents },
    window: { minDays: session.inputs.minDays, maxDays: session.inputs.maxDays },
    now,
    v9: settings.v9,
    v4: settings.v4,
    cap: settings.cap,
    overrideOutside: Boolean(session.inputs.overrideOutside),
  }
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

// The approval card text. Every number comes from the strategy result, nothing is typed by a model.
export function buildCard(result, session) {
  const { metrics: m, strategy } = result
  const labels = (list) => list.map((s) => s.label).join(' ')
  const nowSteps = result.steps.filter((s) => s.phase === 'now')
  const later = result.steps.filter((s) => s.phase === 'scheduled')
  const runNow = strategy === 'A'
    ? `${plural(nowSteps.filter((s) => s.kind === 'override').length, 'keep-override')} -> verify -> ${plural(nowSteps.filter((s) => s.kind === 'plan_price').length, 'plan price change')}`
    : `create ${plural(nowSteps.filter((s) => s.kind === 'create_plan').length, 'new plan')} (for new signups) -> raise ${labels(nowSteps.filter((s) => s.kind === 'raise_now')) || 'nobody'} by PATCH -> verify`
  const planEmail = m.planEmails.pending ? `${m.planEmails.value} subscribers about the plan change (V9 pending)` : `${m.planEmails.value} subscribers about the plan change`
  const patchEmail = m.patchEmails.pending ? `up to ${m.patchEmails.value} raised members by PATCH notice (V4 pending)` : `${m.patchEmails.value} raised members by PATCH notice`
  return {
    strategy,
    newMonthly: toValue(session.inputs.monthlyCents),
    newAnnual: toValue(session.inputs.annualCents),
    raise: result.raiseCount,
    keep: result.keepCount,
    lines: [
      `Run now: ${runNow}`,
      `Scheduled: ${later.length ? later.map((s) => `${s.label} on day ${s.day}`).join(', ') + ` (inside the ${session.inputs.minDays}-${session.inputs.maxDays} day window)` : 'none'}`,
      strategy === 'A'
        ? `Ten-day rule (plan change, PayPal docs): ${result.shiftedSubs.length ? `${result.shiftedSubs.join(', ')} first new charge moves one cycle` : 'none shifted'}`
        : `Ten-day rule (PATCH, PayPal-funded, PayPal docs): ${result.shiftedSubs.length ? `${result.shiftedSubs.join(', ')} scheduled for the next cycle` : 'none shifted'}`,
      result.outsideSubs.length ? `Outside window: ${result.outsideSubs.map((o) => o.label).join(', ')}  [fix: ${result.outsideSubs[0].fix}]` : 'Outside window: none',
      strategy === 'B' ? 'After run: switch your checkout button to the new plan IDs' : 'No checkout change needed',
      `PayPal will email: ${strategy === 'A' ? `${planEmail}; ${patchEmail}` : patchEmail}`,
    ],
    notes: result.notes,
    mrr: { before: fmt(result.mrr.beforeCents), after: fmt(result.mrr.afterCents), delta: fmtDelta(result.mrr.deltaCents) },
  }
}

// Cohort label for a member, read from the plan (frozen at approval once a run happened).
const KEPT_ACTIONS = ['keep', 'keep_override', 'blocked']
export const isKept = (decision) => KEPT_ACTIONS.includes(decision.action)

export function cohortLabel(compare, subId, strategy) {
  const decision = compare?.[strategy || 'B']?.perSub[subId]
  if (!decision) return 'undecided'
  return isKept(decision) ? 'kept' : 'raised'
}

// The plan price changes a run made, by plan id. A subscription on such a plan can still be charged the old price (ten-day rule).
function planChanges(session) {
  const changes = new Map()
  for (const st of session.execution?.steps || []) {
    if (st.kind === 'plan_price' && st.status === 'done' && st.previousCents != null) {
      changes.set(st.planId, { kind: 'plan', changedAt: new Date(st.changedAt), previousCents: st.previousCents })
    }
  }
  return changes
}

// The reason shown next to the default pick. Numbers come from the metric table, nothing is typed by a model.
export function recommendationReason(compare, pick) {
  const m = (s) => compare[s].metrics
  if (pick === 'B') {
    return `B leaves ${m('B').overridesLeft} overrides behind (A: ${m('A').overridesLeft}), sends ${m('B').planEmails.value} plan emails (A: ${m('A').planEmails.value}) and has ${m('B').outsideWindow} members outside your notice window (A: ${m('A').outsideWindow}). It needs a checkout change, so pick A if you cannot touch the button.`
  }
  return `A needs no checkout change. The cost: ${m('A').overridesLeft} overrides left, ${m('A').planEmails.value} plan emails and ${m('A').outsideWindow} members outside your window.`
}

export function metricRows(compare) {
  const a = compare.A.metrics
  const b = compare.B.metrics
  const pend = (x) => (x.pending ? `${x.value} (pending)` : String(x.value))
  return [
    { id: 'writes', label: 'PayPal writes (incl. scheduled)', A: a.writes.total, B: b.writes.total, lowerIsBetter: true },
    { id: 'overridesLeft', label: 'Overrides left behind', A: a.overridesLeft, B: b.overridesLeft, lowerIsBetter: true },
    { id: 'planEmails', label: 'Plan emails', A: pend(a.planEmails), B: pend(b.planEmails), numA: a.planEmails.value, numB: b.planEmails.value, lowerIsBetter: true },
    { id: 'patchEmails', label: 'Patch emails', A: pend(a.patchEmails), B: pend(b.patchEmails), numA: a.patchEmails.value, numB: b.patchEmails.value, lowerIsBetter: true },
    { id: 'tenDayShifted', label: 'Ten-day shifted', A: a.tenDayShifted, B: b.tenDayShifted, lowerIsBetter: true },
    { id: 'outsideWindow', label: 'Outside notice window', A: a.outsideWindow, B: b.outsideWindow, lowerIsBetter: true },
    { id: 'checkoutChange', label: 'Checkout change needed', A: a.checkoutChange ? 'yes' : 'no', B: b.checkoutChange ? 'yes' : 'no', numA: a.checkoutChange ? 1 : 0, numB: b.checkoutChange ? 1 : 0, lowerIsBetter: true },
    { id: 'mrrChange', label: 'MRR change', A: fmtDelta(a.mrrChangeCents), B: fmtDelta(b.mrrChangeCents), numA: a.mrrChangeCents, numB: b.mrrChangeCents, lowerIsBetter: false },
  ]
}

// The execution step log (override, verify, plan price, ...) shown on screen.
function stepLog(session) {
  return (session.execution?.steps || []).map((st) => ({ at: st.at, kind: `step: ${st.kind}`, detail: `${st.label} ${st.status}: ${st.detail}` }))
}

export function buildStudioData({ snapshot, compare, session, now, webhooks, executedStrategy = null, cohortStrategy = null }) {
  const changes = planChanges(session)
  const planName = new Map(snapshot.plans.map((p) => [p.id, p.name]))
  const subscribers = snapshot.subs.map((s) => {
    const derived = deriveNextCharge({ overridden: s.overridden, overridePriceCents: s.priceCents, planPriceCents: s.priceCents, change: s.overridden ? null : changes.get(s.planId) || null, nextBillingTime: s.nextCharge, fundedBy: s.fundedBy })
    const decision = compare?.[cohortStrategy || executedStrategy || 'B'].perSub[s.id]
    return {
      member: s.label,
      plan: planName.get(s.planId) || s.planId,
      cycle: s.interval === 'YEAR' ? 'Annual' : 'Monthly',
      tag: s.tag,
      signup_month: s.signupMonth,
      source: s.source,
      price: s.priceCents / 100,
      overridden: s.overridden ? 'yes' : 'no',
      next_charge: iso(s.nextCharge),
      days_to_charge: s.daysToCharge,
      derived_next_charge: derived.amountCents / 100,
      ten_day_applied: derived.tenDayApplied ? 'yes' : 'no',
      cohort: decision ? (isKept(decision) ? 'Kept' : 'Raised') : 'Undecided',
    }
  })
  const plans = snapshot.plans.flatMap((p) => p.versions.map((v) => ({ plan: p.name, plan_id: p.id, version: v.version, price: v.priceCents / 100, changed_at: v.at || '' })))
  const outcomes = compare
    ? ['A', 'B'].flatMap((k) => [
        { strategy: k, metric: 'PayPal writes', value: compare[k].metrics.writes.total },
        { strategy: k, metric: 'Overrides left', value: compare[k].metrics.overridesLeft },
        { strategy: k, metric: 'Plan emails', value: compare[k].metrics.planEmails.value },
        { strategy: k, metric: 'Outside window', value: compare[k].metrics.outsideWindow },
        { strategy: k, metric: 'MRR change', value: compare[k].metrics.mrrChangeCents / 100 },
      ])
    : []
  const timeline = compare ? (executedStrategy ? [executedStrategy] : ['A', 'B']).flatMap((k) => buildTimeline({ subs: snapshot.subs, strategyPlan: compare[k], now })) : []
  const revenue = compare ? projectRevenue({ subs: snapshot.subs, timeline }) : []
  return {
    subscribers,
    plans,
    strategy_outcomes: outcomes,
    price_timeline: timeline.map((r) => ({ member: r.subscription, strategy: r.strategy, month: r.month, cohort: r.cohort, price: r.priceCents / 100 })),
    projected_revenue: revenue.map((r) => ({ strategy: r.strategy, month: r.month, mrr: r.mrrCents / 100 })),
    events: [...session.events, ...stepLog(session), ...webhooks].map((e) => ({ at: e.at, kind: e.kind || e.type, detail: e.detail || e.resourceId || '' })),
  }
}

export { cohortReport, compareStrategies }
