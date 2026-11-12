import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { createApp } from '../server/routes.js'
import { errorHandler } from '../server/http.js'
import { MockPaypal } from '../server/paypal/mockPaypal.js'
import * as store from '../server/store.js'
import { createLlmLimiter, REASON_LIMIT, REASON_UNAVAILABLE } from '../server/studio/limits.js'
import { runLlmTurn } from '../server/studio/llm.js'
import { loadRecordings } from '../server/studio/recording.js'

// The live Claude protection: caps per IP per hour and per host per day, and a fallback (recorded run or rule-based
// stand-in) when a cap is reached or the API fails. No test makes a real model call.

const user = (text) => ({ id: `u-${text}`, kind: 'input', type: 'message', role: 'user', status: 'completed', content: [{ type: 'text', text }] })
const primaryTools = [{ name: 'scan_subscribers', parameters: { type: 'object', properties: {} } }]
const ask = (text, extra = []) => ({ input: [user(text), ...extra], tools: primaryTools, responseFormat: { type: 'text' } })
const okLive = (calls) => async () => { calls.n += 1; return { response: { id: 'r', output: [] }, source: 'live', label: 'Claude Sonnet (server API key)' } }
const noLog = () => {}

test('a model that throws is answered by the rule-based stand-in with a reason, never a raw error', async () => {
  const live = async () => { throw Object.assign(new Error('credit balance is too low'), { status: 400 }) }
  const guard = createLlmLimiter()
  const out = await runLlmTurn(ask('hello'), { backend: 'api', live, guard, sessionId: 's1', runs: [], onFailure: noLog })
  assert.equal(out.source, 'stand-in')
  assert.equal(out.label, `Rule-based stand-in (${REASON_UNAVAILABLE})`)
  assert.ok(out.response.output.length > 0)
  assert.doesNotMatch(JSON.stringify(out), /credit balance/)
})

test('a timeout falls back too', async () => {
  const live = () => new Promise(() => {})
  const out = await runLlmTurn(ask('hello'), { backend: 'api', live, guard: createLlmLimiter(), sessionId: 's1', runs: [], timeoutMs: 20, onFailure: noLog })
  assert.equal(out.fallback, REASON_UNAVAILABLE)
})

test('the recorded run answers first when it matches the turn', async () => {
  const runs = loadRecordings()
  const first = runs[0].turns[0]
  const request = { input: [user(first.key.userText)], tools: primaryTools, instructions: '', responseFormat: { type: first.key.structured ? 'json' : 'text' } }
  const live = async () => { throw new Error('down') }
  const out = await runLlmTurn(request, { backend: 'api', live, guard: createLlmLimiter(), sessionId: 's1', runs, onFailure: noLog })
  assert.ok(['recorded', 'stand-in'].includes(out.source))
  if (out.source === 'recorded') assert.match(out.label, /^Recorded run: .*live model unavailable/)
})

test('after a failure the rest of the run stays on the fallback and does not call the model again', async () => {
  const calls = { n: 0 }
  let fail = true
  const live = async (r) => { calls.n += 1; if (fail) throw new Error('503'); return okLive({ n: 0 })(r) }
  const guard = createLlmLimiter()
  const opts = { backend: 'api', live, guard, sessionId: 's1', runs: [], onFailure: noLog }
  await runLlmTurn(ask('first'), opts)
  fail = false
  const call = { id: 'c', type: 'function_call', name: 'scan_subscribers', callId: 'k', arguments: '{}' }
  const later = await runLlmTurn(ask('first', [call, { id: 'o', type: 'function_call_output', callId: 'k', status: 'completed', output: '{}' }]), opts)
  assert.equal(calls.n, 1)
  assert.equal(later.fallback, REASON_UNAVAILABLE)
  const next = await runLlmTurn(ask('second'), opts)
  assert.equal(next.source, 'live', 'a new user action tries the model again')
})

test('per IP hourly cap counts runs, not tool turns, and the window moves with a fake clock', async () => {
  let now = new Date('2026-11-12T10:00:00Z')
  const calls = { n: 0 }
  const guard = createLlmLimiter({ perIpHour: 2, perDay: 100, clock: () => now })
  const opts = (sessionId, ip = '1.1.1.1') => ({ backend: 'api', live: okLive(calls), guard, ip, sessionId, runs: [], onFailure: noLog })
  const call = { id: 'c', type: 'function_call', name: 'scan_subscribers', callId: 'k', arguments: '{}' }
  const out = { id: 'o', type: 'function_call_output', callId: 'k', status: 'completed', output: '{}' }
  assert.equal((await runLlmTurn(ask('a'), opts('s1'))).source, 'live')
  assert.equal((await runLlmTurn(ask('a', [call, out]), opts('s1'))).source, 'live', 'second turn of the same run is free')
  assert.equal((await runLlmTurn(ask('b'), opts('s1'))).source, 'live')
  const blocked = await runLlmTurn(ask('c'), opts('s1'))
  assert.equal(blocked.fallback, REASON_LIMIT)
  assert.match(blocked.label, /live limit reached/)
  assert.equal((await runLlmTurn(ask('x'), opts('s2', '2.2.2.2'))).source, 'live', 'another IP is not affected')
  assert.equal(calls.n, 4)
  now = new Date(now.getTime() + 61 * 60000)
  assert.equal((await runLlmTurn(ask('d'), opts('s1'))).source, 'live', 'the hour window has passed')
})

test('per day cap covers the whole host and resets on the next UTC day', async () => {
  let now = new Date('2026-11-12T23:00:00Z')
  const calls = { n: 0 }
  const guard = createLlmLimiter({ perIpHour: 100, perDay: 2, clock: () => now })
  const run = (text, ip) => runLlmTurn(ask(text), { backend: 'api', live: okLive(calls), guard, ip, sessionId: `s-${ip}`, runs: [], onFailure: noLog })
  assert.equal((await run('a', '1.1.1.1')).source, 'live')
  assert.equal((await run('a', '2.2.2.2')).source, 'live')
  assert.equal((await run('a', '3.3.3.3')).fallback, REASON_LIMIT)
  assert.equal(calls.n, 2)
  now = new Date('2026-11-13T00:05:00Z')
  assert.equal((await run('b', '3.3.3.3')).source, 'live')
})

test('mock backend never touches the guard or the model', async () => {
  const calls = { n: 0 }
  const guard = createLlmLimiter({ perIpHour: 0, perDay: 0 })
  const out = await runLlmTurn(ask('hello'), { backend: 'mock', live: okLive(calls), guard, sessionId: 's1', runs: [] })
  assert.equal(calls.n, 0)
  assert.equal(out.source, 'stand-in')
})

test('http: a throwing model and a reached cap both return 200 with the fallback label', async () => {
  store.resetForTests()
  const app = express()
  app.use(express.json())
  const guard = createLlmLimiter({ perIpHour: 1, perDay: 5 })
  const built = createApp({ port: new MockPaypal(), llmLimiter: guard, llmBackend: 'api', liveTurn: async () => { throw new Error('network down') } })
  app.use('/api', built.router)
  app.use(errorHandler)
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)) })
  const base = `http://127.0.0.1:${server.address().port}/api`
  const post = async (p, body) => {
    const res = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return { status: res.status, body: await res.json() }
  }
  const stderrWrite = process.stderr.write
  process.stderr.write = () => true
  try {
    const sessionId = (await post('/session')).body.data.sessionId
    const first = await post('/studio/llm', { sessionId, request: ask('one') })
    assert.equal(first.status, 200)
    assert.equal(first.body.data.fallback, REASON_UNAVAILABLE)
    const second = await post('/studio/llm', { sessionId, request: ask('two') })
    assert.equal(second.status, 200)
    assert.equal(second.body.data.fallback, REASON_LIMIT)
    assert.match(second.body.data.label, /Rule-based stand-in \(live limit reached\)|Recorded run: .*live limit reached/)
  } finally {
    process.stderr.write = stderrWrite
    server.close()
  }
})
