import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { createAgentTools } from '../server/agentTools.js'
import { mockLlmTurn } from '../server/studio/mockLlm.js'
import { loadRecordings } from '../server/studio/recording.js'
import { deskStateText } from '../client/studio/deskState.js'
import { createApp } from '../server/routes.js'
import { errorHandler } from '../server/http.js'
import { MockPaypal } from '../server/paypal/mockPaypal.js'
import * as store from '../server/store.js'
import { makeDesk, PRICED } from './helpers.js'

const userItem = (text) => ({ id: 'u', kind: 'input', type: 'message', role: 'user', status: 'completed', content: [{ type: 'text', text }] })
const textOf = (response) => response.output[0].content[0].text

async function setup() {
  const { desk } = await makeDesk()
  const session = await desk.startSession()
  return { desk, session, tools: createAgentTools(desk) }
}

// REVIEW_4 defect 1: in the widget turns the model only saw its own earlier "draft" sentence.
test('the agent instructions carry the confirmed rule, the typed prices and the run on every turn', async () => {
  const { desk, session } = await setup()
  assert.match(deskStateText(await desk.view(session.id)), /Founder rule: not chosen yet/)
  session.ruleDraft = { selected: 'tag' }
  assert.match(deskStateText(await desk.view(session.id)), /a draft only/)
  desk.setRule(session.id, 'tag')
  desk.setInputs(session.id, PRICED)
  const text = deskStateText(await desk.view(session.id))
  assert.match(text, /CONFIRMED by the operator/)
  assert.match(text, /6 members tagged "founder" \(F1, F2, F3, F4, A3, A4\)/)
  assert.match(text, /Do not call it a draft/)
  assert.match(text, /monthly \$12\.00, annual \$120\.00/)
  assert.equal(deskStateText(null), 'Current desk state: no bundle is open yet.')
})

test('compare_strategies and a later draft both say the rule is confirmed', async () => {
  const { desk, session, tools } = await setup()
  desk.setRule(session.id, 'tag')
  desk.setInputs(session.id, PRICED)
  const result = await tools.run(session.id, 'compare_strategies', {})
  assert.match(result.founderRule, /^Confirmed by the operator in the desk \(no longer a draft\): Tagged founder, 6 members/)
  const draft = await tools.run(session.id, 'propose_cohort_rules', { rules: [{ id: 'signup' }], selected: 'signup' })
  assert.match(draft.note, /still Tagged founder/)
})

// REVIEW_4 defect 2: a count question about one group was answered with the whole bundle.
test('stand-in answers "how many annual members" from the scanned data', async () => {
  const { desk, session, tools } = await setup()
  const ask = 'How many members are on the annual plan?'
  const toolList = [{ name: 'scan_subscribers' }]
  const first = mockLlmTurn({ input: [userItem(ask)], tools: toolList })
  assert.equal(first.output[0].name, 'scan_subscribers')
  const scanOutput = async () => ({ type: 'function_call_output', callId: first.output[0].callId, output: JSON.stringify(await tools.run(session.id, 'scan_subscribers', {})) })
  const before = textOf(mockLlmTurn({ input: [userItem(ask), first.output[0], await scanOutput()], tools: toolList }))
  assert.equal(before, '4 of the 12 members are on the annual plan: A1, A2, A3, A4, paying $90.00 today.')
  desk.setRule(session.id, 'tag')
  const after = textOf(mockLlmTurn({ input: [userItem(ask), first.output[0], await scanOutput()], tools: toolList }))
  assert.match(after, /Your rule keeps 2 of them at their price \(A3, A4\)\./)
  const monthly = textOf(mockLlmTurn({ input: [userItem('How many monthly members?'), first.output[0], await scanOutput()], tools: toolList }))
  assert.match(monthly, /^8 of the 12 members are on the monthly plan/)
})

// REVIEW_4 defect 3: the stand-in topped the pool up after every lease, so the header never went down.
test('stand-in: fresh bundles left goes down by one per opened bundle and the start screen agrees', async () => {
  store.resetForTests()
  const app = express()
  app.use(express.json())
  app.use('/api', createApp({ port: new MockPaypal() }).router)
  app.use(errorHandler)
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)) })
  const base = `http://127.0.0.1:${server.address().port}/api`
  const json = async (url, init) => (await (await fetch(`${base}${url}`, init)).json()).data
  try {
    const start = (await json('/config')).freshBundlesLeft
    assert.ok(start > 2)
    const one = await json('/session', { method: 'POST' })
    assert.equal((await json(`/session/${one.sessionId}`)).freshBundlesLeft, start - 1)
    const two = await json('/session', { method: 'POST' })
    assert.equal((await json(`/session/${two.sessionId}`)).freshBundlesLeft, start - 2)
    assert.equal((await json('/config')).freshBundlesLeft, start - 2, 'a reload shows the same count')
    assert.equal(store.freshBundlesLeft(), start - 2)
  } finally { server.close() }
})

test('the newest recording is replayed first, and its widget answer neither calls the rule a draft nor guesses', () => {
  const runs = loadRecordings()
  const at = (run) => run.turns.map((t) => t.at).sort().at(-1)
  for (let i = 1; i < runs.length; i += 1) assert.ok(at(runs[i - 1]) >= at(runs[i]))
  const reprice = runs[0].turns.filter((t) => t.agentInstructions.startsWith('You are the Reprice Agent'))
  const widgetAnswer = reprice.filter((t) => t.key.userText === 'show kept members by signup month').at(-1)
  assert.doesNotMatch(widgetAnswer.text, /still a draft|until you confirm/i)
  assert.match(widgetAnswer.text, /same query the data agent ran/)
  const filter = runs[0].turns.flatMap((t) => t.toolCalls).find((c) => c.name === 'add_widget_filter')
  assert.match(filter.arguments, /"operator":"equals","value":"Kept"/)
})
