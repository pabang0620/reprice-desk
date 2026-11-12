import { addDays, daysBetween, iso, startOfDay } from './domain/dates.js'
import { fmt } from './domain/money.js'
import { loadSnapshot } from './snapshot.js'

// Order is fixed per strategy. The plan price is never touched until every keep-override reads back correctly.
export class ExecutionError extends Error {
  constructor(message, result) {
    super(message)
    this.result = result
  }
}

// Where a read-back really came from. The stand-in is never called PayPal on screen.
export const sourceName = (mode) => (mode === 'sandbox' ? 'the PayPal sandbox' : 'the PayPal stand-in')

function logStep(result, entry) {
  result.steps.push({ at: new Date().toISOString(), ...entry })
}

async function overrideIfNeeded({ port, sub, priceCents, result, kind }) {
  const current = await port.getSubscription(sub.id)
  if (current.planOverridden && current.priceCents === priceCents) {
    logStep(result, { kind, label: sub.label, status: 'skipped', detail: `already ${fmt(priceCents)} (overridden)` })
    return
  }
  await port.overrideSubscriptionPrice(sub.id, priceCents)
  logStep(result, { kind, label: sub.label, status: 'done', detail: `override ${fmt(priceCents)}` })
}

async function verifyOverride({ port, sub, priceCents }) {
  const read = await port.getSubscription(sub.id)
  return read.planOverridden && read.priceCents === priceCents
}

async function runA({ port, plan, subsById, snapshot, now, result }) {
  const overrides = plan.steps.filter((s) => s.kind === 'override')
  for (const step of overrides) {
    try {
      await overrideIfNeeded({ port, sub: subsById.get(step.subId), priceCents: step.priceCents, result, kind: 'override' })
    } catch (err) {
      logStep(result, { kind: 'override', label: step.label, status: 'failed', detail: err.message })
      throw new ExecutionError(`Override failed for ${step.label}. Plan price was NOT changed.`, result)
    }
  }
  for (const step of overrides) {
    if (!(await verifyOverride({ port, sub: subsById.get(step.subId), priceCents: step.priceCents }))) {
      logStep(result, { kind: 'verify', label: step.label, status: 'failed', detail: 'override did not read back' })
      throw new ExecutionError(`Override for ${step.label} did not read back. Plan price was NOT changed.`, result)
    }
  }
  logStep(result, { kind: 'verify', label: `${overrides.length} overrides`, status: 'done', detail: `all keep-overrides read back from ${sourceName(port.mode)}` })
  for (const step of plan.steps.filter((s) => s.kind === 'plan_price')) {
    try {
      const previousCents = snapshot.plans.find((p) => p.id === step.planId)?.priceCents ?? null
      await port.updatePlanPrice(step.planId, step.priceCents)
      // previousCents and changedAt feed the derived next charge (the ten-day rule), see view.js.
      logStep(result, { kind: 'plan_price', label: step.planId, status: 'done', detail: `plan price ${fmt(step.priceCents)}`, planId: step.planId, previousCents, changedAt: now.toISOString() })
    } catch (err) {
      logStep(result, { kind: 'plan_price', label: step.planId, status: 'failed', detail: err.message })
      throw new ExecutionError(`Plan price change failed: ${err.message}`, result)
    }
  }
  for (const step of plan.steps.filter((s) => s.kind === 'raise_now')) {
    await overrideIfNeeded({ port, sub: subsById.get(step.subId), priceCents: step.targetCents, result, kind: 'raise' })
  }
}

async function runB({ port, plan, subsById, snapshot, result }) {
  for (const step of plan.steps.filter((s) => s.kind === 'create_plan')) {
    const old = snapshot.plans.find((p) => p.interval === step.interval)
    const created = await port.createPlan({ productId: old.productId, name: `${old.name} ${fmt(step.priceCents)} (new signups)`, interval: step.interval, priceCents: step.priceCents })
    result.newPlans.push({ interval: step.interval, planId: created.id, priceCents: step.priceCents })
    logStep(result, { kind: 'create_plan', label: created.id, status: 'done', detail: `new plan ${fmt(step.priceCents)} for new signups` })
  }
  for (const step of plan.steps.filter((s) => s.kind === 'raise_now')) {
    try {
      await overrideIfNeeded({ port, sub: subsById.get(step.subId), priceCents: step.targetCents, result, kind: 'raise' })
    } catch (err) {
      logStep(result, { kind: 'raise', label: step.label, status: 'failed', detail: err.message })
      throw new ExecutionError(`Raise failed for ${step.label}: ${err.message}`, result)
    }
  }
}

function expectedNow(plan, sub) {
  const decision = plan.perSub[sub.id]
  if (!decision) return { priceCents: sub.priceCents, overridden: sub.overridden }
  switch (decision.action) {
    case 'raise_plan': return { priceCents: decision.targetCents, overridden: false }
    case 'raise_now': return { priceCents: decision.targetCents, overridden: true }
    case 'keep_override':
    case 'protect_then_raise': return { priceCents: sub.priceCents, overridden: true }
    case 'outside_window': return { priceCents: decision.targetCents, overridden: false }
    case 'raise_scheduled': return { priceCents: sub.priceCents, overridden: sub.overridden }
    default: return { priceCents: sub.priceCents, overridden: sub.overridden }
  }
}

// A write may only name members and plans of the bundle being run (the set the snapshot just read in full).
// Checked before the first write, so it also runs before any write claim exists.
export function assertStepsInBundle(plan, snapshot) {
  const subIds = new Set(snapshot.subs.map((s) => s.id))
  const planIds = new Set(snapshot.plans.map((p) => p.id))
  for (const step of plan.steps) {
    if (step.subId !== undefined && !subIds.has(step.subId)) throw new ExecutionError(`Step ${step.kind} names a member outside this bundle. Nothing was written.`, null)
    if (step.kind === 'plan_price' && !planIds.has(step.planId)) throw new ExecutionError(`Step ${step.kind} names a plan outside this bundle. Nothing was written.`, null)
  }
}

export async function executePlan({ port, plan, bundle, now }) {
  const result = { ok: false, source: port.mode === 'sandbox' ? 'sandbox' : 'mock', steps: [], readBack: [], newPlans: [], jobs: [], error: null }
  const before = await loadSnapshot({ port, bundle, now })
  const subsById = new Map(before.subs.map((s) => [s.id, s]))
  try {
    assertStepsInBundle(plan, before)
    if (plan.strategy === 'A') await runA({ port, plan, subsById, snapshot: before, now, result })
    else await runB({ port, plan, subsById, snapshot: before, result })
  } catch (err) {
    result.error = err.message
    result.readBack = await readBack({ port, plan, bundle, now, before, aborted: true })
    if (err instanceof ExecutionError) return result
    throw err
  }
  result.readBack = await readBack({ port, plan, bundle, now, before })
  result.jobs = plan.steps.filter((s) => s.phase === 'scheduled').map((s) => ({
    key: `${s.subId}:${s.runOn}`,
    subId: s.subId,
    label: s.label,
    targetCents: s.targetCents,
    runOn: s.runOn,
    firstChargeOn: s.firstChargeOn,
    windowEnd: iso(addDays(startOfDay(s.firstChargeOn), -plan.window.minDays)),
    status: 'pending',
  }))
  result.ok = result.readBack.every((r) => r.ok)
  if (!result.ok) result.error = 'Some prices did not read back as planned. Check the Read back table.'
  return result
}

export async function readBack({ port, plan, bundle, now, before, aborted = false }) {
  const after = await loadSnapshot({ port, bundle, now })
  const beforeById = new Map(before.subs.map((s) => [s.id, s]))
  return after.subs.map((sub) => {
    const prior = beforeById.get(sub.id)
    // After an aborted run no member's price may have changed, so every row is compared with the price before the run.
    const exp = aborted ? { priceCents: prior.priceCents, overridden: prior.overridden } : expectedNow(plan, prior)
    const ok = aborted ? sub.priceCents === prior.priceCents : sub.priceCents === exp.priceCents && sub.overridden === exp.overridden
    return {
      label: sub.label,
      planId: sub.planId,
      priceCents: sub.priceCents,
      overridden: sub.overridden,
      expectedCents: exp.priceCents,
      expectedOverridden: exp.overridden,
      action: plan.perSub[sub.id]?.action || 'keep',
      ok,
    }
  })
}

// Scheduled raises. Idempotent per subscription and day, and only inside the chosen notice window.
export async function runDueJobs({ port, jobs, done, now, minDays }) {
  const today = startOfDay(now)
  const outcomes = []
  for (const job of jobs) {
    if (job.status !== 'pending') continue
    const runOn = startOfDay(job.runOn)
    if (today < runOn) continue
    const key = `${job.subId}:${iso(today)}`
    if (done.has(key)) continue
    const daysToCharge = daysBetween(today, job.firstChargeOn)
    if (daysToCharge < minDays) {
      job.status = 'missed'
      outcomes.push({ label: job.label, status: 'missed', detail: `only ${daysToCharge} days left, below the ${minDays} day notice window` })
      continue
    }
    done.add(key)
    const current = await port.getSubscription(job.subId)
    if (current.planOverridden && current.priceCents === job.targetCents) {
      job.status = 'skipped'
      outcomes.push({ label: job.label, status: 'skipped', detail: 'already at target price' })
      continue
    }
    await port.overrideSubscriptionPrice(job.subId, job.targetCents)
    const check = await port.getSubscription(job.subId)
    job.status = check.priceCents === job.targetCents ? 'done' : 'failed'
    outcomes.push({ label: job.label, status: job.status, detail: `raise to ${fmt(job.targetCents)}` })
  }
  return outcomes
}
