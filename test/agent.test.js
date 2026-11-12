import test from 'node:test'
import assert from 'node:assert/strict'
import { createAgentTools } from '../server/agentTools.js'
import { toAnthropicRequest, fromAnthropicResponse } from '../server/studio/convert.js'
import { mockLlmTurn } from '../server/studio/mockLlm.js'
import { makeDesk, PRICED } from './helpers.js'

const userItem = (text) => ({ id: 'u', kind: 'input', type: 'message', role: 'user', status: 'completed', content: [{ type: 'text', text }] })

async function setup() {
  const { desk } = await makeDesk()
  const session = await desk.startSession()
  return { desk, session, tools: createAgentTools(desk) }
}

test('model-drafted price is ignored', async () => {
  const { desk, session, tools } = await setup()
  desk.setRule(session.id, 'tag')
  desk.setInputs(session.id, PRICED)
  const result = await tools.run(session.id, 'compare_strategies', { plan_draft: { monthly: 15, annual: 150 } })
  assert.equal(result.pricesUsed.monthly, '$12.00')
  assert.equal(result.pricesUsed.annual, '$120.00')
  assert.equal(result.warnings.length, 2)
  assert.equal(session.inputs.monthlyCents, 1200)
})

test('compare is refused until the operator confirmed a cohort rule', async () => {
  const { session, tools } = await setup()
  const result = await tools.run(session.id, 'compare_strategies', {})
  assert.match(result.error, /not confirmed/)
})

test('agent scan reports 4 conflicts and proposing a rule only saves a draft', async () => {
  const { session, tools } = await setup()
  const scan = await tools.run(session.id, 'scan_subscribers', {})
  assert.equal(scan.conflictCount, 4)
  await tools.run(session.id, 'propose_cohort_rules', { rules: [{ id: 'tag' }], selected: 'tag' })
  assert.equal(session.rule, null)
  assert.equal(session.ruleDraft.selected, 'tag')
})

test('agent tool input is validated (extra keys and bad rule are rejected)', async () => {
  const { session, tools } = await setup()
  await assert.rejects(() => tools.run(session.id, 'propose_cohort_rules', { rules: [{ id: 'everyone' }] }), /rules/)
  await assert.rejects(() => tools.run(session.id, 'scan_subscribers', { price: 1 }))
  await assert.rejects(() => tools.run(session.id, 'delete_everything', {}), /Unknown tool/)
})

test('notice draft with amounts the code did not compute is ignored', async () => {
  const { desk, session, tools } = await setup()
  const early = await tools.run(session.id, 'draft_notice', { cohort: 'raise', body: 'Your price moves from $9.00 to $12.00 soon.' })
  assert.equal(early.saved, false, '$12.00 is not a computed amount before the operator typed it')
  desk.setInputs(session.id, PRICED)
  const bad = await tools.run(session.id, 'draft_notice', { cohort: 'raise', body: 'Your price goes to $19.99 next month.' })
  assert.equal(bad.saved, false)
  const good = await tools.run(session.id, 'draft_notice', { cohort: 'raise', body: 'Your price moves from $9.00 to $12.00 soon.' })
  assert.equal(good.saved, true)
})

test('agent sessions are separate: a tool call cannot read another session', async () => {
  const { desk, session, tools } = await setup()
  const other = await desk.startSession()
  desk.setRule(session.id, 'tag')
  desk.setInputs(session.id, PRICED)
  const mine = await tools.run(session.id, 'compare_strategies', {})
  const theirs = await tools.run(other.id, 'compare_strategies', {})
  assert.ok(mine.rows)
  assert.match(theirs.error, /not confirmed/)
})

test('anthropic conversion: tool results, system text and tool schemas', () => {
  const body = toAnthropicRequest({
    instructions: 'Be brief.',
    input: [
      userItem('hi'),
      { id: 'a', kind: 'output', type: 'function_call', callId: 'c1', name: 'scan_subscribers', arguments: '{}' },
      { type: 'function_call_output', callId: 'c1', output: '{"ok":true}', status: 'completed' },
    ],
    tools: [{ name: 'scan_subscribers', description: 'scan', parameters: { type: 'object', properties: {} } }],
    responseFormat: { type: 'text' },
  }, { model: 'claude-sonnet-5-5' })
  assert.equal(body.system, 'Be brief.')
  assert.deepEqual(body.messages.map((m) => m.role), ['user', 'assistant', 'user'])
  assert.equal(body.messages[1].content[0].type, 'tool_use')
  assert.equal(body.messages[2].content[0].type, 'tool_result')
  assert.equal(body.tools[0].name, 'scan_subscribers')
})

test('anthropic response conversion keeps tool calls and text', () => {
  const out = fromAnthropicResponse({ model: 'm', content: [{ type: 'text', text: 'Checking.' }, { type: 'tool_use', id: 't1', name: 'scan_subscribers', input: {} }] })
  assert.deepEqual(out.output.map((o) => o.type), ['message', 'function_call'])
  assert.equal(out.status, 'completed')
})

test('stand-in model follows the tool protocol: scan, propose, then ask with the computed conflicts', () => {
  const tools = [{ name: 'scan_subscribers' }, { name: 'propose_cohort_rules' }]
  const first = mockLlmTurn({ input: [userItem('Keep founders at $9')], tools })
  assert.equal(first.output[0].name, 'scan_subscribers')
  const scanOut = { rules: [{ id: 'tag', members: ['F1'] }, { id: 'signup', members: ['F1', 'R4'] }, { id: 'source', members: ['F1'] }], conflictCount: 4, conflicts: [{ label: 'F4' }, { label: 'R4' }, { label: 'A3' }, { label: 'A4' }] }
  const afterScan = [userItem('Keep founders at $9'), first.output[0], { type: 'function_call_output', callId: first.output[0].callId, output: JSON.stringify(scanOut) }]
  const second = mockLlmTurn({ input: afterScan, tools })
  assert.equal(second.output[0].name, 'propose_cohort_rules')
  const afterPropose = [...afterScan, second.output[0], { type: 'function_call_output', callId: second.output[0].callId, output: '{"saved":true}' }]
  const third = mockLlmTurn({ input: afterPropose, tools })
  assert.match(third.output[0].content[0].text, /disagree on 4 subscribers \(F4, R4, A3, A4\)/)
})
