import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import express from 'express'
import { loadRecordings, normalizeOutput, recordTurn, replayTurn, turnKey } from '../server/studio/recording.js'
import { runLlmTurn, STAND_IN_LABEL } from '../server/studio/llm.js'
import { textItem, toolCallItem, toResponse } from '../server/studio/convert.js'
import { createApp } from '../server/routes.js'
import { errorHandler } from '../server/http.js'
import { MockPaypal } from '../server/paypal/mockPaypal.js'
import * as store from '../server/store.js'

const user = (text) => ({ id: 'u', type: 'message', kind: 'input', role: 'user', content: [{ type: 'text', text }] })
const call = (name, callId) => ({ id: `f-${callId}`, type: 'function_call', kind: 'output', callId, name, arguments: '{}' })
const out = (callId, output) => ({ id: `o-${callId}`, type: 'function_call_output', callId, status: 'completed', output })
const TOOLS = [{ name: 'scan_subscribers' }, { name: 'compare_strategies' }]
const request = (input) => ({ instructions: 'You are the Reprice Agent', tools: TOOLS, input })

function runFrom(turns) {
  return [{ model: 'claude-sonnet-5-5', modelLabel: 'Claude Sonnet', recordedOn: '2026-11-12', turns }]
}

test('replay: a recorded turn is returned with fresh ids and the recorded-run label', () => {
  const req = request([user('Keep founders at $9.')])
  const recorded = toResponse([toolCallItem('scan_subscribers', {})])
  const runs = runFrom([{ key: turnKey(req), output: recorded.output }])
  const hit = replayTurn(request([user('keep founders at $9')]), runs)
  assert.ok(hit)
  assert.equal(hit.label, 'Recorded run: Claude Sonnet, 2026-11-12')
  assert.equal(hit.response.output[0].name, 'scan_subscribers')
  assert.notEqual(hit.response.output[0].callId, recorded.output[0].callId)
  assert.match(hit.response.model, /recorded 2026-11-12/)
})

test('replay: a different tool result (other members, an error) never replays the recorded answer', () => {
  const recordedReq = request([user('Which strategy?'), call('compare_strategies', 'c1'), out('c1', '{"rows":[{"metric":"MRR","A":"+$17.00"}]}')])
  const runs = runFrom([{ key: turnKey(recordedReq), output: [textItem('Recommendation: B (+$17.00)')] }])
  const other = request([user('Which strategy?'), call('compare_strategies', 'c9'), out('c9', '{"error":"Confirm who to keep first."}')])
  assert.equal(replayTurn(other, runs), null)
  const same = request([user('Which strategy?'), call('compare_strategies', 'c9'), out('c9', '{"rows":[{"metric":"MRR","A":"+$17.00"}]}')])
  assert.ok(replayTurn(same, runs))
})

test('replay: dates and ids in tool results are blanked, Studio layout tool results are not compared', () => {
  assert.equal(normalizeOutput('next 2026-11-18T10:00:00Z id I-ABC123 6d'), normalizeOutput('next 2026-11-25T10:00:00Z id I-XYZ999 6d'))
  assert.notEqual(normalizeOutput('days 6'), normalizeOutput('days 7'))
  const tools = [{ name: 'view_widget' }]
  const a = { instructions: 'You configure a single widget', tools, input: [user('configure it'), call('view_widget', 'v1'), out('v1', '{"rendered":false}')] }
  const b = { ...a, input: [user('configure it'), call('view_widget', 'v2'), out('v2', '{"rendered":true,"rows":3}')] }
  const runs = runFrom([{ key: turnKey(a), output: [textItem('Configured.')] }])
  assert.ok(replayTurn(b, runs))
})

test('replay: the stand-in answers turns outside the recording and says it is a stand-in', async () => {
  const result = await runLlmTurn(request([user('Keep founders at $9')]), { runs: [] })
  assert.equal(result.source, 'stand-in')
  assert.equal(result.label, STAND_IN_LABEL)
  assert.equal(result.response.output[0].name, 'scan_subscribers')
})

test('recorder writes the key, tool calls in order, model text and timing', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'rd-rec-'))
  try {
    const file = path.join(dir, 'run.json')
    const req = request([user('Keep founders')])
    recordTurn(file, req, toResponse([textItem('Scanning.'), toolCallItem('scan_subscribers', {})]), { ms: 1234, model: 'claude-sonnet-5-5' })
    recordTurn(file, req, toResponse([textItem('Done.')]), { ms: 900, model: 'claude-sonnet-5-5' })
    const run = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(run.turns.length, 2)
    assert.equal(run.turns[0].text, 'Scanning.')
    assert.deepEqual(run.turns[0].toolCalls.map((c) => c.name), ['scan_subscribers'])
    assert.equal(run.turns[0].ms, 1234)
    assert.match(run.backend, /no API key/)
    assert.equal(loadRecordings(dir).length, 1)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('the shipped recording replays the README path in order', () => {
  const runs = loadRecordings()
  assert.ok(runs.length >= 1)
  const run = runs[0]
  const reprice = run.turns.filter((t) => t.agentInstructions.startsWith('You are the Reprice Agent'))
  const calls = reprice.flatMap((t) => t.toolCalls.map((c) => c.name))
  assert.deepEqual(calls.slice(0, 3), ['scan_subscribers', 'propose_cohort_rules', 'compare_strategies'])
  assert.ok(calls.includes('delegate_to'))
  assert.ok(run.turns.every((t) => typeof t.ms === 'number' && t.key && Array.isArray(t.output)))
})

test('config: a fresh stand-in server shows fresh bundles before the first session, and only PASS evidence or measured findings', async () => {
  store.resetForTests()
  const app = express()
  app.use(express.json())
  app.use('/api', createApp({ port: new MockPaypal() }).router)
  app.use(errorHandler)
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)) })
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/config`)
    const { data } = await res.json()
    assert.ok(data.freshBundlesLeft > 0)
    const all = [...data.sandboxEvidence.sandbox, ...data.sandboxEvidence.model]
    // A FINDING is a measured sandbox result (V18), never a claimed pass of a skipped item.
    assert.ok(all.every((e) => e.result.startsWith('PASS') || e.result === 'FINDING'))
    assert.ok(!all.some((e) => ['V4', 'V9', 'V10', 'V13', 'V14', 'V16'].includes(e.id)))
  } finally { server.close() }
})
