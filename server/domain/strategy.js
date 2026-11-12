import { addDays, cycleDays, iso } from './dates.js'
import { monthlyCents } from './money.js'

// PayPal ignores a price change when the next charge is within 10 days (plan change: D1, subscription PATCH: D2).
export const TEN_DAY_RULE_DAYS = 10

export function tenDayRuleApplies({ kind, fundedBy, daysUntilCharge }) {
  if (daysUntilCharge > TEN_DAY_RULE_DAYS) return false
  if (kind === 'plan') return true
  if (kind === 'patch') return fundedBy === 'PAYPAL'
  throw new Error(`Unknown change kind: ${kind}`)
}

export function validateWindow(window) {
  const { minDays, maxDays } = window
  if (!Number.isInteger(minDays) || !Number.isInteger(maxDays) || minDays < 1 || maxDays < minDays) {
    throw new Error('Notice window must be whole days with min <= max.')
  }
  if (maxDays < TEN_DAY_RULE_DAYS) {
    throw new Error('PayPal ignores a price change inside the next 10 days, so the notice window must reach at least 10 days.')
  }
}

// An increase cap is configurable (INCREASE_CAP_PCT). No cap is assumed: the sandbox accepted a 33 percent raise (V1 b).
// A cap makes a two-step raise unavailable inside the cap period, so the choice is clamp now or block.
export function resolveTarget(sub, targetCents, cap) {
  if (!cap) return { targetCents, status: 'ok' }
  const limit = Math.floor(sub.priceCents * (1 + cap.pct / 100))
  if (targetCents <= limit) return { targetCents, status: 'ok' }
  if (cap.mode === 'clamp') return { targetCents: limit, status: 'clamped', wantedCents: targetCents }
  return { targetCents: sub.priceCents, status: 'blocked', wantedCents: targetCents }
}

function classify(subs, intent, prices, cap) {
  const raise = []
  const blocked = []
  const clamped = []
  for (const sub of subs) {
    const wanted = prices[sub.interval]
    if (intent[sub.id] !== 'raise' || wanted == null || wanted <= sub.priceCents) continue
    const resolved = resolveTarget(sub, wanted, cap)
    if (resolved.status === 'blocked') blocked.push({ sub, wantedCents: wanted })
    else {
      raise.push({ sub, targetCents: resolved.targetCents })
      if (resolved.status === 'clamped') clamped.push({ sub, targetCents: resolved.targetCents, wantedCents: wanted })
    }
  }
  return { raise, blocked, clamped }
}

function scheduledJob(sub, targetCents, day, firstChargeDays, now) {
  return {
    phase: 'scheduled',
    kind: 'scheduled_raise',
    subId: sub.id,
    label: sub.label,
    targetCents,
    day,
    runOn: iso(addDays(now, day)),
    firstChargeOn: iso(addDays(now, firstChargeDays)),
    noticeDays: firstChargeDays - day,
  }
}

// Strategy A: keep-overrides first, then the plan price. Raise subs on the plan follow the plan change.
// Strategy B: new plan for new signups, raise only the chosen subs one by one.
export function planStrategy({ strategy, subs, intent, prices, window, now, v9 = null, v4 = null, cap = null, overrideOutside = false }) {
  if (strategy !== 'A' && strategy !== 'B') throw new Error('Strategy must be A or B.')
  validateWindow(window)
  const { raise, blocked, clamped } = classify(subs, intent, prices, cap)
  const raiseById = Object.fromEntries(raise.map((r) => [r.sub.id, r]))
  const intervals = [...new Set(raise.map((r) => r.sub.interval))].sort()
  const steps = []
  const perSub = {}
  const outsideSubs = []
  const shiftedSubs = []
  const notes = []

  const patchNow = (sub, targetCents, noticeDays) => {
    steps.push({ phase: 'now', kind: 'raise_now', subId: sub.id, label: sub.label, targetCents })
    perSub[sub.id] = { action: 'raise_now', targetCents, firstChargeDays: noticeDays, noticeDays }
  }
  const schedule = (sub, targetCents, day, firstChargeDays, action) => {
    steps.push(scheduledJob(sub, targetCents, day, firstChargeDays, now))
    perSub[sub.id] = { action, targetCents, firstChargeDays, noticeDays: firstChargeDays - day, runDay: day }
  }
  const viaPatch = (sub, targetCents) => {
    const d0 = sub.daysToCharge
    const cyc = cycleDays(sub.nextCharge, sub.interval)
    if (d0 > window.maxDays) return schedule(sub, targetCents, d0 - window.maxDays, d0, 'raise_scheduled')
    const skip = tenDayRuleApplies({ kind: 'patch', fundedBy: sub.fundedBy, daysUntilCharge: d0 }) || d0 < window.minDays
    if (!skip) return patchNow(sub, targetCents, d0)
    shiftedSubs.push(sub.label)
    const next = d0 + cyc
    return schedule(sub, targetCents, Math.max(next - window.maxDays, d0 + 1), next, 'raise_scheduled')
  }

  let planChanges = 0
  let overrides = 0
  let waitUntil = null
  if (strategy === 'A') {
    const overrideSteps = []
    const planSteps = []
    for (const interval of intervals) {
      const planSubs = subs.filter((s) => s.interval === interval)
      const targetFor = Math.max(...raise.filter((r) => r.sub.interval === interval).map((r) => r.targetCents))
      for (const sub of planSubs) {
        const r = raiseById[sub.id]
        if (r && sub.overridden) { viaPatch(sub, r.targetCents); continue }
        if (r && sub.daysToCharge <= window.maxDays) {
          const shifted = tenDayRuleApplies({ kind: 'plan', fundedBy: sub.fundedBy, daysUntilCharge: sub.daysToCharge })
          const first = shifted ? sub.daysToCharge + cycleDays(sub.nextCharge, interval) : sub.daysToCharge
          const inside = first >= window.minDays && first <= window.maxDays
          if (!inside && overrideOutside) {
            // The operator chose the fix: pin the current price now, raise later by a scheduled PATCH inside the window.
            overrideSteps.push({ phase: 'now', kind: 'override', subId: sub.id, label: sub.label, priceCents: sub.priceCents, reason: 'protect' })
            viaPatch(sub, r.targetCents)
            perSub[sub.id] = { ...perSub[sub.id], action: 'protect_then_raise' }
            continue
          }
          if (shifted) shiftedSubs.push(sub.label)
          perSub[sub.id] = { action: inside ? 'raise_plan' : 'outside_window', targetCents: r.targetCents, firstChargeDays: first, noticeDays: first, shifted }
          if (!inside) outsideSubs.push({ label: sub.label, noticeDays: first, fix: 'Override now at the current price, raise later with a scheduled PATCH.' })
          continue
        }
        if (sub.overridden) { perSub[sub.id] = { action: 'keep', targetCents: sub.priceCents }; continue }
        overrideSteps.push({ phase: 'now', kind: 'override', subId: sub.id, label: sub.label, priceCents: sub.priceCents, reason: r ? 'protect' : 'keep' })
        perSub[sub.id] = { action: r ? 'protect_then_raise' : 'keep_override', targetCents: r ? r.targetCents : sub.priceCents }
        if (r) steps.push(scheduledJob(sub, r.targetCents, sub.daysToCharge - window.maxDays, sub.daysToCharge, now))
        if (r) perSub[sub.id] = { ...perSub[sub.id], firstChargeDays: sub.daysToCharge, noticeDays: window.maxDays, runDay: sub.daysToCharge - window.maxDays }
      }
      planSteps.push({ phase: 'now', kind: 'plan_price', interval, planId: planSubs[0]?.planId, priceCents: targetFor })
    }
    planChanges = planSteps.length
    overrides = overrideSteps.length
    // PayPal accepts an override PATCH inside the ten-day zone but does not apply it (sandbox, VERIFY V18). Pinning a
    // kept member is the precondition for the plan change, so A waits until those members were charged once.
    const late = overrideSteps.map((st) => subs.find((s) => s.id === st.subId)).filter((s) => tenDayRuleApplies({ kind: 'patch', fundedBy: s.fundedBy, daysUntilCharge: s.daysToCharge }))
    if (late.length) {
      const day = Math.max(...late.map((s) => s.daysToCharge)) + 1
      waitUntil = { day, date: iso(addDays(now, day)), labels: late.map((s) => s.label) }
      notes.push(`Strategy A must wait: ${late.map((s) => s.label).join(', ')} ${late.length === 1 ? 'is' : 'are'} charged within 10 days, and PayPal accepted but did not apply an override inside 10 days in the sandbox. Approve A on or after ${waitUntil.date}, or choose B.`)
    }
    steps.unshift(...overrideSteps, ...planSteps)
  } else {
    const plans = intervals.map((interval) => ({ phase: 'now', kind: 'create_plan', interval, priceCents: Math.max(...raise.filter((r) => r.sub.interval === interval).map((r) => r.targetCents)) }))
    steps.push(...plans)
    for (const r of raise) viaPatch(r.sub, r.targetCents)
  }

  for (const sub of subs) {
    if (!perSub[sub.id]) perSub[sub.id] = { action: 'keep', targetCents: sub.priceCents }
  }
  for (const b of blocked) perSub[b.sub.id] = { action: 'blocked', targetCents: b.sub.priceCents, wantedCents: b.wantedCents }
  if (blocked.length) notes.push(`${blocked.length} member(s) cannot be raised in one step: PayPal's increase cap (${cap.pct} percent per ${cap.days} days) blocks the jump, and a second step inside the cap period is not available.`)
  if (clamped.length) notes.push(`${clamped.length} member(s) are raised only to the cap limit now. A next step is possible after ${cap.days} days.`)

  const now_ = steps.filter((s) => s.phase === 'now')
  const later = steps.filter((s) => s.phase === 'scheduled')
  const raiseCount = raise.length
  const plansAffected = new Set(strategy === 'A' ? intervals : [])
  const onAffectedPlans = subs.filter((s) => plansAffected.has(s.interval))
  const stillPlanFollowing = onAffectedPlans.filter((s) => !s.overridden && !steps.some((st) => st.kind === 'override' && st.subId === s.id))
  const raisePatches = steps.filter((s) => s.kind === 'raise_now' || s.kind === 'scheduled_raise').length
  const base = subs.reduce((sum, s) => sum + monthlyCents(s.priceCents, s.interval), 0)
  const delta = raise.reduce((sum, r) => sum + monthlyCents(r.targetCents, r.sub.interval) - monthlyCents(r.sub.priceCents, r.sub.interval), 0)
  const overridesLeft = strategy === 'A' ? overrides : raisePatches

  const metrics = {
    writes: { now: now_.length, scheduled: later.length, total: steps.length },
    overridesLeft,
    planEmails: { value: strategy === 'B' ? 0 : v9 === false ? stillPlanFollowing.length : onAffectedPlans.length, pending: strategy === 'A' && v9 == null },
    patchEmails: { value: v4 === false ? 0 : raisePatches, pending: v4 == null },
    tenDayShifted: shiftedSubs.length,
    outsideWindow: outsideSubs.length,
    checkoutChange: strategy === 'B' && intervals.length > 0,
    mrrChangeCents: Math.round(delta),
  }
  const expectedWebhooks = {
    now: strategy === 'A'
      ? { pricingChange: planChanges, subscriptionUpdated: overrides + steps.filter((s) => s.kind === 'raise_now').length }
      : { pricingChange: 0, subscriptionUpdated: steps.filter((s) => s.kind === 'raise_now').length },
    later: { subscriptionUpdated: later.length },
  }
  return {
    strategy,
    steps,
    perSub,
    metrics,
    raiseCount,
    keepCount: subs.length - raiseCount - blocked.length,
    outsideSubs,
    blocked: blocked.map((b) => b.sub.label),
    clamped: clamped.map((c) => ({ label: c.sub.label, targetCents: c.targetCents, wantedCents: c.wantedCents })),
    shiftedSubs,
    expectedWebhooks,
    mrr: { beforeCents: Math.round(base), afterCents: Math.round(base + delta), deltaCents: Math.round(delta) },
    planChanges,
    waitUntil,
    notes,
  }
}

export function compareStrategies(input) {
  return { A: planStrategy({ ...input, strategy: 'A' }), B: planStrategy({ ...input, strategy: 'B' }) }
}
