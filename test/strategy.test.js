import test from 'node:test'
import assert from 'node:assert/strict'
import { cohortReport, intentFromRule } from '../server/domain/cohort.js'
import { compareStrategies, planStrategy, tenDayRuleApplies } from '../server/domain/strategy.js'
import { deriveNextCharge } from '../server/domain/derive.js'
import { addDays, iso, rollForward } from '../server/domain/dates.js'
import { MockPaypal } from '../server/paypal/mockPaypal.js'
import { loadSnapshot } from '../server/snapshot.js'
import { NOW, PRICES, WINDOW, seedSubs } from './helpers.js'

function plan(strategy, extra = {}) {
  const subs = extra.subs || seedSubs()
  return planStrategy({ strategy, subs, intent: intentFromRule('tag', subs), prices: PRICES, window: WINDOW, now: NOW, ...extra })
}

test('seed numbers: MRR 102.00 to 119.00 (+17.00)', () => {
  const a = plan('A')
  assert.equal(a.mrr.beforeCents, 10200)
  assert.equal(a.mrr.afterCents, 11900)
  assert.equal(a.mrr.deltaCents, 1700)
})

test('strategy A counts match the plan table', () => {
  const m = plan('A').metrics
  assert.deepEqual(m.writes, { now: 10, scheduled: 2, total: 12 })
  assert.equal(m.overridesLeft, 8)
  assert.equal(m.planEmails.value, 12)
  assert.equal(m.tenDayShifted, 1)
  assert.equal(m.outsideWindow, 1)
  assert.equal(m.checkoutChange, false)
  const r = plan('A')
  assert.equal(r.planChanges, 2)
  assert.equal(r.outsideSubs[0].label, 'R1')
  assert.deepEqual(r.steps.filter((s) => s.phase === 'scheduled').map((s) => `${s.label}:${s.day}`), ['A1:15', 'A2:90'])
})

test('strategy B counts match the plan table', () => {
  const r = plan('B')
  assert.deepEqual(r.metrics.writes, { now: 5, scheduled: 3, total: 8 })
  assert.equal(r.metrics.overridesLeft, 6)
  assert.equal(r.metrics.planEmails.value, 0)
  assert.equal(r.metrics.tenDayShifted, 1)
  assert.deepEqual(r.shiftedSubs, ['R1'])
  assert.equal(r.metrics.outsideWindow, 0)
  assert.equal(r.metrics.checkoutChange, true)
  assert.deepEqual(r.steps.filter((s) => s.phase === 'scheduled').map((s) => `${s.label}:${s.day}`), ['R1:5', 'A1:15', 'A2:90'])
  assert.deepEqual(r.steps.filter((s) => s.kind === 'raise_now').map((s) => s.label), ['R2', 'R3', 'R4'])
})

test('both strategies yield same mrr delta for same intent', () => {
  const { A, B } = compareStrategies({ subs: seedSubs(), intent: intentFromRule('tag', seedSubs()), prices: PRICES, window: WINDOW, now: NOW })
  assert.equal(A.mrr.deltaCents, B.mrr.deltaCents)
})

test('webhook counts follow the chosen strategy', () => {
  assert.deepEqual(plan('B').expectedWebhooks, { now: { pricingChange: 0, subscriptionUpdated: 3 }, later: { subscriptionUpdated: 3 } })
  assert.deepEqual(plan('A').expectedWebhooks.now, { pricingChange: 2, subscriptionUpdated: 8 })
})

test('cohort conflicts are counted from the seed (4 subscribers)', () => {
  const report = cohortReport(seedSubs())
  assert.deepEqual(report.conflictLabels.sort(), ['A3', 'A4', 'F4', 'R4'])
  assert.deepEqual(report.byRule.tag, ['F1', 'F2', 'F3', 'F4', 'A3', 'A4'])
})

test('plan change ten day rule ignores funding source', () => {
  assert.equal(tenDayRuleApplies({ kind: 'plan', fundedBy: 'CARD', daysUntilCharge: 4 }), true)
  assert.equal(tenDayRuleApplies({ kind: 'plan', fundedBy: 'PAYPAL', daysUntilCharge: 11 }), false)
})

test('subscription patch ten day rule applies to paypal-funded only', () => {
  assert.equal(tenDayRuleApplies({ kind: 'patch', fundedBy: 'PAYPAL', daysUntilCharge: 4 }), true)
  assert.equal(tenDayRuleApplies({ kind: 'patch', fundedBy: 'CARD', daysUntilCharge: 4 }), false)
})

test('derived next charge uses override then plan then ten day rule', () => {
  const base = { overridden: true, overridePriceCents: 900, planPriceCents: 1200, nextBillingTime: addDays(NOW, 30) }
  assert.deepEqual(deriveNextCharge(base), { amountCents: 900, source: 'override', tenDayApplied: false })
  assert.equal(deriveNextCharge({ ...base, overridden: false }).amountCents, 1200)
  const shifted = deriveNextCharge({ ...base, overridden: false, nextBillingTime: addDays(NOW, 4), change: { kind: 'plan', changedAt: NOW, previousCents: 900 } })
  assert.deepEqual(shifted, { amountCents: 900, source: 'plan', tenDayApplied: true })
})

test('aged bundle: dates roll forward so numbers stay consistent in December', async () => {
  const later = new Date('2026-12-08T10:00:00Z')
  const mock = new MockPaypal({ clock: () => NOW })
  const bundle = await mock.seedBundle({ seededAt: NOW })
  // Same PayPal data read 26 days after seeding: every billing date that passed has been rolled forward.
  const { subs } = await loadSnapshot({ port: mock, bundle, now: later })
  assert.ok(subs.every((s) => s.daysToCharge >= 0))
  const r1 = subs.find((s) => s.label === 'R1')
  assert.equal(iso(r1.nextCharge), '2026-12-16')
  assert.equal(r1.daysToCharge, 8)
  const r = planStrategy({ strategy: 'B', subs, intent: intentFromRule('tag', subs), prices: PRICES, window: WINDOW, now: later })
  assert.equal(r.steps.find((s) => s.label === 'R1').runOn, '2026-12-17')
  assert.ok(r.shiftedSubs.includes('R1'))
})

test('rollForward moves a past monthly date by whole cycles and keeps future dates', () => {
  assert.equal(iso(rollForward('2026-11-17T00:00:00Z', 'MONTH', new Date('2026-12-08T10:00:00Z'))), '2026-12-17')
  assert.equal(iso(rollForward('2026-11-17T00:00:00Z', 'MONTH', NOW)), '2026-11-17')
  assert.equal(iso(rollForward('2026-01-31T00:00:00Z', 'YEAR', new Date('2027-01-01T00:00:00Z'))), '2027-01-31')
})

test('twenty percent per 180 days cap: no two-step raise, clamp or block', () => {
  const cap = { pct: 20, days: 180 }
  const blocked = plan('B', { cap: { ...cap, mode: 'block' } })
  assert.equal(blocked.raiseCount, 0)
  assert.equal(blocked.blocked.length, 6)
  assert.match(blocked.notes[0], /second step inside the cap period is not available/)
  const clamped = plan('B', { cap: { ...cap, mode: 'clamp' } })
  assert.equal(clamped.raiseCount, 6)
  assert.ok(clamped.steps.filter((s) => s.kind === 'raise_now').every((s) => s.targetCents === 1080))
  assert.equal(clamped.clamped[0].wantedCents, 1200)
  assert.ok(clamped.mrr.deltaCents < 1700)
})

test('notice window below ten days is rejected', () => {
  assert.throws(() => plan('A', { window: { minDays: 3, maxDays: 8 } }), /at least 10 days/)
})
