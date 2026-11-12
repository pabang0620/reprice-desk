import test from 'node:test'
import assert from 'node:assert/strict'
import { createAgentTools } from '../server/agentTools.js'
import { mockLlmTurn } from '../server/studio/mockLlm.js'
import { keptSummary } from '../client/widgets/keptSummary.js'
import { makeDesk, PRICED } from './helpers.js'

const userItem = (text) => ({ id: 'u', kind: 'input', type: 'message', role: 'user', status: 'completed', content: [{ type: 'text', text }] })
const textOf = (response) => response.output[0].content[0].text

async function setup() {
  const { desk } = await makeDesk()
  const session = await desk.startSession()
  return { desk, session, tools: createAgentTools(desk) }
}

test('no price is prefilled: nothing is compared or approved until the operator types both prices', async () => {
  const { desk, session, tools } = await setup()
  assert.equal(session.inputs.monthlyCents, null)
  assert.equal(session.inputs.annualCents, null)
  desk.setRule(session.id, 'tag')
  const view = await desk.view(session.id)
  assert.equal(view.compare, null)
  assert.equal(view.pricesMissing, true)
  await assert.rejects(() => desk.prepareApproval(session.id, 'B'), /Type the new monthly and annual price/)
  const refused = await tools.run(session.id, 'compare_strategies', {})
  assert.match(refused.error, /has not typed the new prices/)
  desk.setInputs(session.id, { monthly: 12 })
  assert.equal((await desk.view(session.id)).compare, null, 'one price is not enough')
  desk.setInputs(session.id, { annual: 120 })
  const ready = await desk.view(session.id)
  assert.equal(ready.pricesMissing, false)
  assert.ok(ready.compare.rows.length === 8)
})

test('compare tool states open checks in plain sentences, never as field names', async () => {
  const { desk, session, tools } = await setup()
  desk.setRule(session.id, 'tag')
  desk.setInputs(session.id, PRICED)
  const result = await tools.run(session.id, 'compare_strategies', {})
  const json = JSON.stringify(result)
  assert.doesNotMatch(json, /v9PlanEmailToKept|v4PatchEmail|findings/)
  assert.match(result.openChecks[0], /^Not checked in the sandbox yet: whether PayPal emails the kept/)
})

test('a run on the stand-in says so: read back from the PayPal stand-in, never "from PayPal"', async () => {
  const { desk, session, tools } = await setup()
  desk.setRule(session.id, 'tag')
  desk.setInputs(session.id, PRICED)
  const { planId } = await desk.prepareApproval(session.id, 'B')
  const execution = await desk.approveAndRun(session.id, planId)
  assert.equal(execution.source, 'mock')
  const proof = keptSummary(execution.readBack, execution.source)
  assert.match(proof.text, /\(read back from the PayPal stand-in\)$/)
  assert.match(keptSummary(execution.readBack, 'sandbox').text, /\(read back from the PayPal sandbox\)$/)
  const report = await tools.run(session.id, 'get_execution_report', {})
  assert.equal(report.readBackFrom, 'the PayPal stand-in')
})

test('stand-in: a price given in chat is refused with where to type it', () => {
  const answer = mockLlmTurn({ input: [userItem('Raise founders to $15 now.')], tools: [{ name: 'scan_subscribers' }, { name: 'compare_strategies' }] })
  assert.equal(answer.output[0].type, 'message')
  assert.match(textOf(answer), /cannot set or change a price/)
  assert.match(textOf(answer), /approval card/)
})

test('stand-in: off-script questions get a useful answer from a tool, not the conflict question again', () => {
  const tools = [{ name: 'scan_subscribers' }, { name: 'get_schedule_preview' }, { name: 'compare_strategies' }]
  const ask = 'What does the ten-day rule do here?'
  const first = mockLlmTurn({ input: [userItem(ask)], tools })
  assert.equal(first.output[0].name, 'get_schedule_preview')
  const preview = { strategy: 'B', scheduled: [{ member: 'R1', runOn: '2026-11-17', noticeDays: 30 }], tenDayShifted: ['R1'], outsideWindow: [] }
  const second = mockLlmTurn({ input: [userItem(ask), first.output[0], { type: 'function_call_output', callId: first.output[0].callId, output: JSON.stringify(preview) }], tools })
  assert.match(textOf(second), /shifted by the ten-day rule: R1/)
  const safety = mockLlmTurn({ input: [userItem('What if PayPal fails halfway?')], tools })
  assert.match(textOf(safety), /plan price is not changed/)
})

test('stand-in: after the rule is confirmed a general question gets the status, not a new rule draft', () => {
  const tools = [{ name: 'scan_subscribers' }, { name: 'propose_cohort_rules' }]
  const first = mockLlmTurn({ input: [userItem('Hello, where am I?')], tools })
  assert.equal(first.output[0].name, 'scan_subscribers')
  const scan = { confirmedRule: 'tag', subscribers: new Array(12).fill({}), rules: [{ id: 'tag', members: ['F1', 'F2', 'F3', 'F4', 'A3', 'A4'] }], conflicts: [], conflictCount: 4 }
  const second = mockLlmTurn({ input: [userItem('Hello, where am I?'), first.output[0], { type: 'function_call_output', callId: first.output[0].callId, output: JSON.stringify(scan) }], tools })
  assert.equal(second.output[0].type, 'message')
  assert.match(textOf(second), /12 members in this bundle\. Your rule keeps the 6/)
})

test('stand-in mirrors V18: an override inside 10 days of a charge is accepted but not applied', async () => {
  const { MockPaypal } = await import('../server/paypal/mockPaypal.js')
  const { NOW } = await import('./helpers.js')
  const mock = new MockPaypal({ clock: () => NOW })
  const bundle = await mock.seedBundle({ seededAt: NOW })
  const id = (label) => bundle.subscriptions.find((s) => s.label === label).subId
  await mock.overrideSubscriptionPrice(id('R1'), 900)
  await mock.overrideSubscriptionPrice(id('R2'), 900)
  assert.equal((await mock.getSubscription(id('R1'))).planOverridden, false, 'R1 is charged in 4 days')
  assert.equal((await mock.getSubscription(id('R2'))).planOverridden, true, 'R2 is charged in 12 days')
})

test('on seed day strategy A needs no wait (F1 is seeded 16 days out) and runs end to end', async () => {
  const { desk } = await makeDesk({ bundles: 1 })
  const session = await desk.startSession()
  desk.setRule(session.id, 'tag')
  desk.setInputs(session.id, PRICED)
  const { planId, card } = await desk.prepareApproval(session.id, 'A')
  assert.equal(card.waitUntil, null)
  const execution = await desk.approveAndRun(session.id, planId)
  assert.equal(execution.ok, true)
})
