import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import express from 'express'
import { config } from '../server/config.js'
import * as store from '../server/store.js'
import { addDays } from '../server/domain/dates.js'
import { MockPaypal } from '../server/paypal/mockPaypal.js'
import { createApp } from '../server/routes.js'
import { createLlmLimiter } from '../server/studio/limits.js'
import { mockLlmTurn } from '../server/studio/mockLlm.js'
import { errorHandler } from '../server/http.js'
import { NOW, makeDesk, PRICED } from './helpers.js'

const minutes = (n) => new Date(NOW.getTime() + n * 60000)

async function prepared(desk, strategy = 'B') {
  const session = await desk.startSession()
  desk.setRule(session.id, 'tag')
  desk.setInputs(session.id, PRICED)
  const { planId } = await desk.prepareApproval(session.id, strategy)
  return { session, planId }
}

// Defect 1
test('expired lease handed to another session: the first session can no longer execute', async () => {
  let now = NOW
  const { desk, mock } = await makeDesk({ bundles: 1, clock: () => now })
  const first = await prepared(desk)
  now = minutes(31)
  const second = await desk.startSession()
  assert.equal(second.bundleId, first.session.bundleId, 'the expired lease went back to the pool')
  await assert.rejects(() => desk.approveAndRun(first.session.id, first.planId), /lease on this bundle ended/)
  assert.equal(mock.calls.filter((c) => c.call === 'patchSubscription').length, 0, 'nothing was written')
  desk.setRule(second.id, 'tag')
  desk.setInputs(second.id, PRICED)
  const next = await desk.prepareApproval(second.id, 'B')
  assert.equal((await desk.approveAndRun(second.id, next.planId)).ok, true)
})

test('a used bundle rejects a second execution even from a stale session', async () => {
  let now = NOW
  const { desk } = await makeDesk({ bundles: 1, clock: () => now })
  const a = await prepared(desk)
  await desk.approveAndRun(a.session.id, a.planId)
  now = minutes(31)
  await assert.rejects(() => desk.approveAndRun(a.session.id, a.planId), /already ran/)
  assert.equal(store.getBundle(a.session.bundleId).status, 'used')
})

test('activity renews the lease, so a working session keeps its bundle', async () => {
  let now = NOW
  const { desk } = await makeDesk({ bundles: 1, clock: () => now })
  const a = await prepared(desk)
  now = minutes(20)
  desk.setInputs(a.session.id, { monthly: 13 })
  now = minutes(40)
  assert.equal(store.freshBundlesLeft(now), 0, 'renewed at minute 20, still leased at minute 40')
  const { planId } = await desk.prepareApproval(a.session.id, 'B')
  assert.equal((await desk.approveAndRun(a.session.id, planId)).ok, true)
})

// Defect 2
test('bundles seeded into the file while the server runs are kept and leased', async () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'rd-')), 'bundles.json')
  const original = config.bundlesFile
  config.bundlesFile = file
  try {
    store.resetForTests()
    const mock = new MockPaypal({ clock: () => NOW })
    store.loadBundles([])
    store.addBundles([await mock.seedBundle({ seededAt: NOW })])
    // Another process (the seed script) writes a new bundle straight into the file.
    const onDisk = JSON.parse(readFileSync(file, 'utf8'))
    const extra = { ...(await mock.seedBundle({ seededAt: NOW })), status: 'fresh', leasedBy: null, leasedAt: null, usedAt: null }
    writeFileSync(file, JSON.stringify([...onDisk, extra]))
    assert.equal(store.freshBundlesLeft(NOW), 2)
    store.leaseBundle('s1', NOW)
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(saved.length, 2, 'the lease write did not drop the new bundle')
    assert.ok(saved.some((b) => b.id === extra.id))
  } finally {
    config.bundlesFile = original
    store.resetForTests()
  }
})

test('merge never moves a bundle backwards', () => {
  const used = { id: 'B1', status: 'used' }
  const merged = store.mergeBundles([used], [{ id: 'B1', status: 'fresh' }, { id: 'B2', status: 'fresh' }])
  assert.equal(merged.find((b) => b.id === 'B1').status, 'used')
  assert.equal(merged.length, 2)
})

// Defects 4, 8, 14, 12
test('after a run the view classifies members from the executed plan, not from the new prices', async () => {
  const { desk } = await makeDesk()
  const { session, planId } = await prepared(desk)
  await desk.approveAndRun(session.id, planId)
  const view = await desk.view(session.id)
  const cohort = (label) => view.studio.subscribers.find((s) => s.member === label).cohort
  assert.equal(cohort('R2'), 'Raised')
  assert.equal(cohort('F1'), 'Kept')
  assert.equal(view.subs.find((s) => s.label === 'R2').cohort, 'raised')
  assert.ok(view.studio.price_timeline.every((r) => r.strategy === 'B'))
  assert.ok(view.studio.events.some((e) => e.kind.startsWith('step:')), 'step log is on screen')
})

test('run rejects a plan that is not the current approval', async () => {
  const { desk, mock } = await makeDesk()
  const { session, planId } = await prepared(desk)
  desk.setInputs(session.id, { monthly: 15 })
  await assert.rejects(() => desk.approveAndRun(session.id, planId), /not the current approval/)
  assert.equal(mock.calls.filter((c) => c.call === 'patchSubscription').length, 0)
  const fresh = await desk.prepareApproval(session.id, 'B')
  assert.equal((await desk.approveAndRun(session.id, fresh.planId)).ok, true)
})

test('recommendation reason comes from the metric table', async () => {
  const { desk } = await makeDesk()
  const { session } = await prepared(desk)
  const view = await desk.view(session.id)
  assert.match(view.recommendedReason, /B leaves 6 overrides behind \(A: 8\)/)
})

// Defect 6, 13
async function boot() {
  store.resetForTests()
  const app = express()
  app.use(express.json())
  const built = createApp({ port: new MockPaypal(), llmLimiter: createLlmLimiter() })
  app.use('/api', built.router)
  app.use(errorHandler)
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)) })
  const base = `http://127.0.0.1:${server.address().port}/api`
  const call = async (method, p, body) => {
    const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    return { status: res.status, body: await res.json() }
  }
  return { call, close: () => server.close() }
}

test('notice window with min above max is rejected and the session keeps working', async () => {
  const { call, close } = await boot()
  try {
    const id = (await call('POST', '/session')).body.data.sessionId
    assert.equal((await call('PUT', `/session/${id}/inputs`, { minDays: 40, maxDays: 30 })).status, 400)
    assert.equal((await call('PUT', `/session/${id}/inputs`, { minDays: 40 })).status, 400, 'merged with the stored max of 30')
    const view = await call('GET', `/session/${id}`)
    assert.equal(view.status, 200)
    assert.equal(view.body.data.inputs.minDays, 7)
  } finally { close() }
})

test('sub-cent prices are rejected', async () => {
  const { call, close } = await boot()
  try {
    const id = (await call('POST', '/session')).body.data.sessionId
    assert.equal((await call('PUT', `/session/${id}/inputs`, { monthly: 0.001 })).status, 400)
    assert.equal((await call('PUT', `/session/${id}/inputs`, { monthly: 12.345 })).status, 400)
    assert.equal((await call('PUT', `/session/${id}/inputs`, { monthly: 12.5 })).status, 200)
  } finally { close() }
})

// Defect 5
test('studio llm proxy needs a live session and answers from the fallback when a turn cap is reached', async () => {
  const { call, close } = await boot()
  const request = { input: [{ id: '1', kind: 'input', type: 'message', role: 'user', status: 'completed', content: [{ type: 'text', text: 'hello' }] }], responseFormat: { type: 'text' } }
  try {
    assert.equal((await call('POST', '/studio/llm', { request })).status, 400, 'no session id')
    assert.equal((await call('POST', '/studio/llm', { sessionId: '6f1d4c52-0c9e-4a9e-9a53-7a0a0b1c2d3e', request })).status, 404)
    const a = (await call('POST', '/session')).body.data.sessionId
    const res = await call('POST', '/studio/llm', { sessionId: a, request })
    assert.equal(res.status, 200)
    assert.equal(res.body.data.source, 'stand-in')
  } finally { close() }
})

// Defect 7
test('stand-in says so when the widget delegation failed', () => {
  const tool = { name: 'delegate_to_agents', parameters: { type: 'object', properties: { agent: { type: 'string' } } } }
  const user = { id: 'u', kind: 'input', type: 'message', role: 'user', status: 'completed', content: [{ type: 'text', text: 'Show kept members by signup month.' }] }
  const call = { id: 'c', type: 'function_call', name: tool.name, callId: 'k1', arguments: '{}' }
  const failed = mockLlmTurn({ input: [user, call, { id: 'o', type: 'function_call_output', callId: 'k1', status: 'failed', output: 'Delegation failed' }], tools: [tool] })
  assert.match(JSON.stringify(failed), /could not run/)
  assert.doesNotMatch(JSON.stringify(failed), /finished/)
  const ok = mockLlmTurn({ input: [user, call, { id: 'o', type: 'function_call_output', callId: 'k1', status: 'completed', output: JSON.stringify({ success: true, data: {} }) }], tools: [tool] })
  assert.match(JSON.stringify(ok), /finished/)
})

// Defect 14
test('stand-in sessions and bundles are capped', async () => {
  const { desk } = await makeDesk({ bundles: 0 })
  const { maxSessions, bundleStoreMax } = config
  config.maxSessions = 3
  config.bundleStoreMax = 4
  try {
    const mock = new MockPaypal({ clock: () => NOW })
    for (let i = 0; i < 6; i += 1) store.addBundles([{ ...(await mock.seedBundle({ seededAt: NOW })), status: 'used', usedAt: minutes(i).toISOString() }])
    assert.equal(store.totalBundles(), 4)
    const first = await desk.startSession()
    for (let i = 0; i < 4; i += 1) await desk.startSession()
    assert.equal(store.allSessions().length, 3)
    assert.equal(store.getSession(first.id), null, 'oldest session dropped')
  } finally {
    config.maxSessions = maxSessions
    config.bundleStoreMax = bundleStoreMax
  }
})
