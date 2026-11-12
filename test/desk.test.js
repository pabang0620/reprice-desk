import test from 'node:test'
import assert from 'node:assert/strict'
import * as store from '../server/store.js'
import { addDays } from '../server/domain/dates.js'
import { NOW, makeDesk, PRICED } from './helpers.js'

async function ready(desk, strategy) {
  const session = await desk.startSession()
  desk.setRule(session.id, 'tag')
  desk.setInputs(session.id, PRICED)
  const { planId } = await desk.prepareApproval(session.id, strategy)
  return { session, planId }
}

test('plan price is never updated before every keep-override is verified', async () => {
  const { desk, log } = await makeDesk({ record: true })
  const { session, planId } = await ready(desk, 'A')
  await desk.approveAndRun(session.id, planId)
  const firstPlanUpdate = log.findIndex((l) => l.call === 'updatePlanPrice')
  const overrideIdx = log.map((l, i) => (l.call === 'overrideSubscriptionPrice' ? i : -1)).filter((i) => i >= 0)
  assert.ok(firstPlanUpdate > 0)
  const keepOverrides = overrideIdx.filter((i) => i < firstPlanUpdate)
  assert.equal(keepOverrides.length, 8)
  const reads = log.slice(keepOverrides[7], firstPlanUpdate).filter((l) => l.call === 'getSubscription')
  assert.ok(reads.length >= 8, 'every override is read back before the plan price changes')
})

test('failed override aborts plan update', async () => {
  const { desk, mock } = await makeDesk({ mockOptions: { failOverrideFor: [] } })
  const session = await desk.startSession()
  desk.setRule(session.id, 'tag')
  desk.setInputs(session.id, PRICED)
  const { planId } = await desk.prepareApproval(session.id, 'A')
  const bundle = store.getBundle(session.bundleId)
  mock.failOverrideFor.add(bundle.subscriptions.find((s) => s.label === 'F3').subId)
  const result = await desk.approveAndRun(session.id, planId)
  assert.equal(result.ok, false)
  assert.match(result.error, /Plan price was NOT changed/)
  assert.equal(mock.calls.filter((c) => c.call === 'updateBillingPlanPricingSchemes').length, 0)
  assert.ok(result.readBack.every((r) => r.ok), 'no member price moved')
})

test('same plan id cannot execute twice', async () => {
  const { desk } = await makeDesk()
  const { session, planId } = await ready(desk, 'B')
  await desk.approveAndRun(session.id, planId)
  await assert.rejects(() => desk.approveAndRun(session.id, planId), /already ran/)
})

test('concurrent approvals of one plan write once', async () => {
  const { desk, mock } = await makeDesk()
  const { session, planId } = await ready(desk, 'B')
  const results = await Promise.allSettled([desk.approveAndRun(session.id, planId), desk.approveAndRun(session.id, planId)])
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  assert.equal(mock.calls.filter((c) => c.call === 'patchSubscription').length, 3)
})

test('approval rejected when subscriber set changed', async () => {
  const { desk, mock } = await makeDesk()
  const { session, planId } = await ready(desk, 'B')
  const bundle = store.getBundle(session.bundleId)
  await mock.overrideSubscriptionPrice(bundle.subscriptions.find((s) => s.label === 'R2').subId, 1000)
  const writesBefore = mock.calls.length
  await assert.rejects(() => desk.approveAndRun(session.id, planId), /Review again/)
  assert.equal(mock.calls.length, writesBefore)
})

test('strategy B end state: founders untouched, raised members overridden, new plans created', async () => {
  const { desk } = await makeDesk()
  const { session, planId } = await ready(desk, 'B')
  const result = await desk.approveAndRun(session.id, planId)
  assert.equal(result.ok, true)
  assert.equal(result.newPlans.length, 2)
  const byLabel = Object.fromEntries(result.readBack.map((r) => [r.label, r]))
  for (const l of ['F1', 'F2', 'F3', 'F4', 'A3', 'A4']) assert.equal(byLabel[l].overridden, false)
  for (const l of ['R2', 'R3', 'R4']) assert.deepEqual([byLabel[l].priceCents, byLabel[l].overridden], [1200, true])
  assert.deepEqual(result.jobs.map((j) => `${j.label}:${j.runOn}`), ['R1:2026-11-17', 'A1:2026-11-27', 'A2:2027-02-10'])
  const view = await desk.view(session.id)
  assert.equal(view.webhooks.filter((w) => w.type === 'BILLING.SUBSCRIPTION.UPDATED').length, 3)
  assert.equal(view.webhooks.filter((w) => w.type === 'BILLING.PLAN.PRICING-CHANGE.ACTIVATED').length, 0)
})

test('strategy A end state: overrides kept, plan prices raised', async () => {
  const { desk } = await makeDesk()
  const { session, planId } = await ready(desk, 'A')
  const result = await desk.approveAndRun(session.id, planId)
  assert.equal(result.ok, true)
  const byLabel = Object.fromEntries(result.readBack.map((r) => [r.label, r]))
  assert.equal(byLabel.F1.priceCents, 900)
  assert.equal(byLabel.R2.priceCents, 1200)
  assert.equal(byLabel.R2.overridden, false)
  assert.equal(byLabel.A1.priceCents, 9000)
  const view = await desk.view(session.id)
  assert.equal(view.webhooks.filter((w) => w.type === 'BILLING.PLAN.PRICING-CHANGE.ACTIVATED').length, 2)
  assert.equal(view.webhooks.filter((w) => w.type === 'BILLING.SUBSCRIPTION.UPDATED').length, 8)
})

test('used bundle is never leased again', async () => {
  const { desk } = await makeDesk({ bundles: 1 })
  const { session, planId } = await ready(desk, 'B')
  await desk.approveAndRun(session.id, planId)
  assert.equal(store.freshBundlesLeft(NOW), 0)
  const next = await desk.startSession()
  assert.equal(next.readOnly, true)
  assert.notEqual(next.bundleId, session.bundleId)
})

test('exhausted bundles still reach compare but approve is blocked', async () => {
  const { desk } = await makeDesk({ bundles: 0 })
  const session = await desk.startSession()
  assert.equal(session.readOnly, true)
  desk.setRule(session.id, 'tag')
  desk.setInputs(session.id, PRICED)
  const { planId } = await desk.prepareApproval(session.id, 'B')
  await assert.rejects(() => desk.approveAndRun(session.id, planId), /No fresh sandbox bundle left/)
  const view = await desk.view(session.id)
  assert.equal(view.compare.B.metrics.writes.total, 8)
})

test('bundles older than the max age are not leased', async () => {
  const { desk } = await makeDesk({ bundles: 1, clock: () => addDays(NOW, 5) })
  assert.equal(store.freshBundlesLeft(addDays(NOW, 5)), 0)
  const session = await desk.startSession()
  assert.equal(session.readOnly, true)
})

test('scheduled raise runs only inside chosen notice window', async () => {
  // The stand-in reads the same clock as the scheduler: an override inside 10 days of a charge is not applied (V18).
  let now = NOW
  const { desk, mock } = await makeDesk({ clock: () => now })
  const { session, planId } = await ready(desk, 'B')
  await desk.approveAndRun(session.id, planId)
  assert.deepEqual(await desk.runScheduler(session.id, NOW), [])
  now = addDays(NOW, 5)
  const out = await desk.runScheduler(session.id, now)
  assert.deepEqual(out.map((o) => `${o.label}:${o.status}`), ['R1:done'])
  // A1 starts 45 days out: on day 40 only 5 days remain, which is below the 7 day minimum.
  now = addDays(NOW, 40)
  const late = await desk.runScheduler(session.id, now)
  assert.ok(late.some((o) => o.label === 'A1' && o.status === 'missed'))
  assert.equal(mock.calls.filter((c) => c.call === 'patchSubscription').length, 4)
})

test('scheduled raise is idempotent per subscription and day', async () => {
  const { desk, mock } = await makeDesk()
  const { session, planId } = await ready(desk, 'B')
  await desk.approveAndRun(session.id, planId)
  const day = addDays(NOW, 5)
  await desk.runScheduler(session.id, day)
  const before = mock.calls.length
  assert.deepEqual(await desk.runScheduler(session.id, day), [])
  assert.equal(mock.calls.length, before)
})

test('scheduler skips subscription already at target price', async () => {
  let now = NOW
  const { desk, mock } = await makeDesk({ clock: () => now })
  const { session, planId } = await ready(desk, 'B')
  await desk.approveAndRun(session.id, planId)
  const bundle = store.getBundle(session.bundleId)
  now = addDays(NOW, 5)
  await mock.overrideSubscriptionPrice(bundle.subscriptions.find((s) => s.label === 'R1').subId, 1200)
  const before = mock.calls.length
  const out = await desk.runScheduler(session.id, now)
  assert.deepEqual(out.map((o) => o.status), ['skipped'])
  assert.equal(mock.calls.length, before)
})
