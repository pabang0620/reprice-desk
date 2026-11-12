import test from 'node:test'
import assert from 'node:assert/strict'
import { actions, deskStore } from '../client/deskStore.js'

test('reload resumes the same session after a temporary failure using reads only', async (t) => {
  const calls = []
  let available = false
  let approval = null
  const saved = new Map([['reprice-desk.session', 'existing']])
  t.mock.method(globalThis, 'fetch', async (url, { method }) => {
    calls.push([method, url])
    if (url === '/api/config') return Response.json({ data: { freshBundlesLeft: 4 } })
    assert.equal(url, '/api/session/existing')
    if (!available) return Response.json({ success: false, message: 'Try again' }, { status: 503 })
    return Response.json({ data: { sessionId: 'existing', approval, execution: approval ? null : { ok: true } } })
  })
  const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: { getItem: (key) => saved.get(key), removeItem: (key) => saved.delete(key) },
  })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'sessionStorage', original)
    else delete globalThis.sessionStorage
  })
  await actions.loadConfig()
  assert.equal(deskStore.get().error, 'Try again')
  assert.equal(saved.get('reprice-desk.session'), 'existing')
  available = true
  await actions.loadConfig()
  assert.equal(deskStore.get().view.execution.ok, true)
  assert.equal(deskStore.get().sessionId, 'existing')
  approval = { status: 'ready', strategy: 'B', planId: 'same-plan', card: { raise: 4 } }
  await actions.loadConfig()
  assert.equal(deskStore.get().card.planId, 'same-plan')
  assert.deepEqual(calls.map(([method]) => method), Array(6).fill('GET'))
})
