import test from 'node:test'
import assert from 'node:assert/strict'
import { addDays } from '../server/domain/dates.js'
import { buildTimeline, deriveNextCharge } from '../server/domain/derive.js'
import { isKept } from '../server/view.js'
import { accountEnv, buildPrompt, toolDefinitions, toTurnResponse, runAccountTurn } from '../server/studio/accountLlm.js'
import { keptSummary, chipTone } from '../client/widgets/keptSummary.js'
import { clockTime } from '../client/studio/clockTime.js'
import { makeDesk, NOW, PRICED } from './helpers.js'

async function runStrategy(strategy, { inputs } = {}) {
  const { desk } = await makeDesk({ bundles: 1 })
  const session = await desk.startSession()
  desk.setRule(session.id, 'tag')
  desk.setInputs(session.id, PRICED)
  if (inputs) desk.setInputs(session.id, inputs)
  const { planId } = await desk.prepareApproval(session.id, strategy)
  await desk.approveAndRun(session.id, planId)
  return { desk, session, view: await desk.view(session.id) }
}

const cohortOf = (view) => Object.fromEntries(view.studio.subscribers.map((s) => [s.member, s.cohort]))

test('after strategy A, founders F1-F4 are Kept and R1-R4 are Raised in the Members table', async () => {
  const { view } = await runStrategy('A')
  const c = cohortOf(view)
  for (const k of ['F1', 'F2', 'F3', 'F4']) assert.equal(c[k], 'Kept', k)
  for (const k of ['R1', 'R2', 'R3', 'R4']) assert.equal(c[k], 'Raised', k)
})

test('before a run the Members cohort follows the strategy chosen on the approval card', async () => {
  const { desk } = await makeDesk({ bundles: 1 })
  const session = await desk.startSession()
  desk.setRule(session.id, 'tag')
  desk.setInputs(session.id, PRICED)
  await desk.prepareApproval(session.id, 'A')
  const view = await desk.view(session.id)
  assert.equal(cohortOf(view).F1, 'Kept')
  assert.equal(cohortOf(view).R2, 'Raised')
})

test('keep, keep_override and blocked count as kept; raises do not', () => {
  for (const action of ['keep', 'keep_override', 'blocked']) assert.equal(isKept({ action }), true)
  for (const action of ['raise_now', 'raise_plan', 'protect_then_raise', 'outside_window']) assert.equal(isKept({ action }), false)
})

test('derived next charge: R1 (4 days to charge) stays $9.00 after A, and the ten-day rule is applied to a plain subscription', async () => {
  const { view } = await runStrategy('A')
  const rows = Object.fromEntries(view.studio.subscribers.map((s) => [s.member, s]))
  assert.equal(rows.R1.derived_next_charge, 9)
  assert.equal(rows.F1.ten_day_applied, 'no')
  const change = { kind: 'plan', changedAt: NOW, previousCents: 900 }
  const plain = deriveNextCharge({ overridden: false, overridePriceCents: 1200, planPriceCents: 1200, change, nextBillingTime: addDays(NOW, 4) })
  assert.equal(plain.amountCents, 900)
  assert.equal(plain.tenDayApplied, true)
})

test('light theme: the styles define a separate variable set for .rd-light', async () => {
  const { readFileSync } = await import('node:fs')
  const css = readFileSync(new URL('../client/styles.css', import.meta.url), 'utf8')
  assert.match(css, /\.rd-light\s*\{[^}]*--text:\s*#0f1b33/)
  assert.match(css, /\.rd-light\s*\{[^}]*--mint:/)
  const studio = readFileSync(new URL('../client/studio/DeskStudio.jsx', import.meta.url), 'utf8')
  assert.match(studio, /rd-light/)
})

test('override-outside choice plans a pin for R1, and A waits because R1 is charged within 10 days (V18)', async () => {
  const { desk, mock } = await makeDesk({ bundles: 1 })
  const s = await desk.startSession()
  desk.setRule(s.id, 'tag')
  desk.setInputs(s.id, { ...PRICED, overrideOutside: true })
  const prepared = await desk.prepareApproval(s.id, 'A')
  const plan = s.plans.get(prepared.planId)
  const r1 = (await desk.view(s.id)).subs.find((x) => x.label === 'R1')
  assert.equal(plan.perSub[r1.id].action, 'protect_then_raise')
  assert.ok(plan.steps.some((x) => x.kind === 'override' && x.subId === r1.id))
  assert.equal(plan.outsideSubs.length, 0)
  assert.deepEqual(plan.waitUntil, { day: 5, date: '2026-11-17', labels: ['R1'] })
  assert.equal(prepared.card.waitUntil, '2026-11-17')
  const writesBefore = mock.calls.filter((c) => c.call !== 'createSubscription' && c.call !== 'createBillingPlan').length
  await assert.rejects(() => desk.approveAndRun(s.id, prepared.planId), /must wait until 2026-11-17: R1/)
  assert.equal(mock.calls.filter((c) => c.call !== 'createSubscription' && c.call !== 'createBillingPlan').length, writesBefore, 'nothing written')
})

test('kept summary line comes from the read-back rows', () => {
  const rows = [
    { label: 'F1', action: 'keep_override', priceCents: 900, expectedCents: 900, overridden: true, ok: true },
    { label: 'F2', action: 'keep_override', priceCents: 900, expectedCents: 900, overridden: true, ok: true },
    { label: 'R2', action: 'raise_plan', priceCents: 1200, expectedCents: 1200, overridden: false, ok: true },
  ]
  const s = keptSummary(rows)
  assert.equal(s.ok, true)
  assert.match(s.text, /F1 F2 at \$9\.00, plan_overridden=true/)
  assert.equal(keptSummary([rows[2]]), null)
  assert.equal(chipTone(rows[0]), 'kept')
  assert.equal(chipTone(rows[2]), 'raised')
  assert.equal(chipTone({ ...rows[2], ok: false }), 'bad')
})

test('run log time is HH:MM:SS', () => {
  assert.equal(clockTime('2026-11-12T02:16:09.123Z'), '02:16:09')
})

test('account backend strips the API key and token from the Claude Code environment', () => {
  const env = accountEnv({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_AUTH_TOKEN: 't', PATH: '/bin' })
  assert.deepEqual(env, { PATH: '/bin' })
})

test('account backend maps a transcript to a prompt and tool calls to Studio output items (fake SDK)', async () => {
  const request = {
    instructions: 'sys',
    input: [
      { type: 'message', kind: 'input', role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { type: 'function_call', callId: 'c1', name: 'scan_subscribers', arguments: '{}' },
      { type: 'function_call_output', callId: 'c1', output: '{"ok":1}' },
    ],
    tools: [{ name: 'scan_subscribers', description: 'd', parameters: { type: 'object', properties: {} } }],
  }
  const prompt = buildPrompt(request)
  assert.match(prompt, /\[user\] hello/)
  assert.match(prompt, /\[tool result\] \{"ok":1\}/)
  assert.equal(toolDefinitions(request).length, 1)
  let seen = null
  const fake = {
    tool: (name, description, shape, handler) => ({ name, handler }),
    createSdkMcpServer: ({ tools }) => ({ tools }),
    query: ({ options }) => {
      seen = options
      return (async function* () {
        await options.mcpServers.studio.tools[0].handler({})
        yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Scanning.' }] } }
        yield { type: 'result', subtype: 'error_max_turns' }
      })()
    },
  }
  const prev = process.env.ANTHROPIC_API_KEY
  process.env.ANTHROPIC_API_KEY = 'sk-should-not-leak'
  const out = await runAccountTurn(request, { loader: async () => fake, model: 'claude-sonnet-5-5' })
  if (prev === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = prev
  assert.equal(seen.env.ANTHROPIC_API_KEY, undefined)
  assert.deepEqual(seen.tools, [])
  assert.equal(out.output[0].type, 'message')
  assert.equal(out.output[1].type, 'function_call')
  assert.equal(out.output[1].name, 'scan_subscribers')
})

test('structured turns return the respond tool input as JSON text', () => {
  const out = toTurnResponse({ calls: [{ name: 'mcp__studio__respond', input: { a: 1 } }], texts: [], resultText: '', structured: true, model: 'm' })
  assert.equal(out.output.length, 1)
  assert.equal(out.output[0].content[0].text, '{"a":1}')
})

test('buildTimeline marks the kept cohort for keep_override', () => {
  const sub = { id: 's', label: 'F1', priceCents: 900, interval: 'MONTH' }
  const rows = buildTimeline({ subs: [sub], strategyPlan: { strategy: 'A', perSub: { s: { action: 'keep_override' } } }, now: addDays(NOW, 0) })
  assert.equal(rows[0].cohort, 'kept')
})
