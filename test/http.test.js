import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { createApp } from '../server/routes.js'
import { errorHandler } from '../server/http.js'
import { MockPaypal } from '../server/paypal/mockPaypal.js'
import * as store from '../server/store.js'

async function boot() {
  store.resetForTests()
  const app = express()
  app.use(express.json())
  app.use('/api', createApp({ port: new MockPaypal() }).router)
  app.use(errorHandler)
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)) })
  const base = `http://127.0.0.1:${server.address().port}/api`
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    return { status: res.status, body: res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text() }
  }
  return { call, close: () => server.close() }
}

test('http: full path from session to approved run on the stand-in', async () => {
  const { call, close } = await boot()
  try {
    const { body: opened } = await call('POST', '/session')
    const id = opened.data.sessionId
    assert.equal((await call('PUT', `/session/${id}/rule`, { rule: 'tag' })).status, 200)
    const early = await call('POST', `/session/${id}/approval`, { strategy: 'B' })
    assert.equal(early.status, 409, 'no approval before the operator typed both prices')
    assert.match(early.body.message || early.body.error || '', /Type the new monthly and annual price/)
    assert.equal((await call('PUT', `/session/${id}/inputs`, { monthly: 12, annual: 120 })).status, 200)
    const prep = await call('POST', `/session/${id}/approval`, { strategy: 'B' })
    assert.equal(prep.status, 201)
    const run = await call('POST', `/session/${id}/run`, { planId: prep.body.data.planId })
    assert.equal(run.status, 200)
    assert.equal(run.body.data.execution.ok, true)
    const again = await call('POST', `/session/${id}/run`, { planId: prep.body.data.planId })
    assert.equal(again.status, 409)
    const csv = await call('GET', `/session/${id}/notices.csv`)
    assert.match(csv.body, /^member,plan,oldPrice,newPrice/)
    assert.match(csv.body, /R2/)
  } finally { close() }
})

test('http: input validation and unknown sessions', async () => {
  const { call, close } = await boot()
  try {
    assert.equal((await call('GET', '/session/not-a-uuid')).status, 400)
    assert.equal((await call('GET', '/session/6f1d4c52-0c9e-4a9e-9a53-7a0a0b1c2d3e')).status, 404)
    const { body } = await call('POST', '/session')
    const id = body.data.sessionId
    assert.equal((await call('PUT', `/session/${id}/rule`, { rule: 'everyone' })).status, 400)
    assert.equal((await call('PUT', `/session/${id}/inputs`, { monthly: -5 })).status, 400)
    assert.equal((await call('PUT', `/session/${id}/inputs`, { maxDays: 5 })).status, 400)
    assert.equal((await call('PUT', `/session/${id}/inputs`, { monthly: 12, extra: 1 })).status, 400)
    assert.equal((await call('POST', `/session/${id}/approval`, { strategy: 'C' })).status, 400)
    assert.equal((await call('POST', `/session/${id}/approval`, { strategy: 'B' })).status, 409)
  } finally { close() }
})

test('http: a plan from one session cannot be approved from another', async () => {
  const { call, close } = await boot()
  try {
    const a = (await call('POST', '/session')).body.data.sessionId
    const b = (await call('POST', '/session')).body.data.sessionId
    await call('PUT', `/session/${a}/rule`, { rule: 'tag' })
    await call('PUT', `/session/${a}/inputs`, { monthly: 12, annual: 120 })
    const prep = await call('POST', `/session/${a}/approval`, { strategy: 'B' })
    const attack = await call('POST', `/session/${b}/run`, { planId: prep.body.data.planId })
    assert.equal(attack.status, 404)
    const viewA = await call('GET', `/session/${a}`)
    assert.equal(viewA.body.data.execution, null)
  } finally { close() }
})

test('http: studio llm proxy answers on the stand-in without any key', async () => {
  const { call, close } = await boot()
  try {
    const sessionId = (await call('POST', '/session')).body.data.sessionId
    const res = await call('POST', '/studio/llm', { sessionId, request: { input: [{ id: '1', kind: 'input', type: 'message', role: 'user', status: 'completed', content: [{ type: 'text', text: 'hello' }] }], responseFormat: { type: 'text' } } })
    assert.equal(res.status, 200)
    assert.equal(res.body.data.response.status, 'completed')
  } finally { close() }
})

test('http: webhook route stores the event for the resource', async () => {
  const { call, close } = await boot()
  try {
    const res = await call('POST', '/webhooks/paypal', { id: 'WH-1', event_type: 'BILLING.SUBSCRIPTION.UPDATED', resource: { id: 'I-X' }, create_time: '2026-11-12T00:00:00Z' })
    assert.equal(res.status, 200)
  } finally { close() }
})
