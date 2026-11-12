import test from 'node:test'
import assert from 'node:assert/strict'
import { toAnthropicRequest } from '../server/studio/convert.js'
import { liveTurn, runLlmTurn } from '../server/studio/llm.js'

const user = (text) => ({ type: 'message', kind: 'input', role: 'user', content: [{ type: 'text', text }] })
const tool = (name) => ({ name, description: name, parameters: { type: 'object', properties: {} } })
const base = { input: [user('hi')], tools: [tool('scan_subscribers')] }

// Fake API that behaves like the hosted model: forced tool choice is a 400.
function fakeClient(replies) {
  const calls = []
  return {
    calls,
    messages: {
      async create(body) {
        calls.push(body)
        const tc = body.tool_choice
        if (tc && (tc.type === 'tool' || tc.type === 'any')) {
          const err = new Error('tool_choice: type "tool" and "any" are not supported for this model')
          err.status = 400
          throw err
        }
        return replies.shift()
      },
    },
  }
}
const text = (t) => ({ model: 'm', content: [{ type: 'text', text: t }] })
const use = (name) => ({ model: 'm', content: [{ type: 'tool_use', id: 't1', name, input: {} }] })

test('no request shape carries a forced tool_choice', () => {
  const shapes = [
    base,
    { ...base, toolChoice: 'required' },
    { ...base, toolChoice: { name: 'scan_subscribers' } },
    { ...base, toolChoice: 'none' },
    { ...base, responseFormat: { type: 'json', schema: { type: 'object', properties: {} } } },
  ]
  for (const s of shapes) {
    const body = toAnthropicRequest(s, { model: 'm' })
    assert.equal(body.tool_choice, undefined)
  }
  assert.match(toAnthropicRequest({ ...base, toolChoice: 'required' }, { model: 'm' }).system, /call one of the tools/)
  assert.match(toAnthropicRequest({ ...base, toolChoice: { name: 'scan_subscribers' } }, { model: 'm' }).system, /calling the tool scan_subscribers/)
  const structured = toAnthropicRequest(shapes[4], { model: 'm' })
  assert.match(structured.system, /calling the tool respond/)
  assert.ok(structured.tools.some((t) => t.name === 'respond'))
})

test('model that answers in text once is retried with the instruction repeated', async () => {
  const client = fakeClient([text('no tool'), use('scan_subscribers')])
  const result = await liveTurn({ ...base, toolChoice: 'required' }, { client })
  assert.equal(client.calls.length, 2)
  assert.ok(client.calls.every((b) => !b.tool_choice))
  assert.equal(result.response.output.at(-1).type, 'function_call')
  const occurrences = (s) => s.split('call one of the tools in this turn').length - 1
  assert.equal(occurrences(client.calls[1].system), occurrences(client.calls[0].system) + 1)
})

test('model that never calls the tool falls back to the labelled stand-in', async () => {
  const client = fakeClient([text('a'), text('b')])
  const result = await runLlmTurn({ ...base, toolChoice: 'required' }, {
    backend: 'live', runs: [], recordFile: '', onFailure: () => {}, live: (req) => liveTurn(req, { client }),
  })
  assert.equal(client.calls.length, 2)
  assert.ok(['stand-in', 'recorded'].includes(result.source))
  assert.ok(result.fallback)
})
