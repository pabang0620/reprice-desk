import { test } from 'node:test'
import assert from 'node:assert/strict'
import { errorHandler } from '../server/http.js'
import { executePlan, assertStepsInBundle } from '../server/executor.js'
import { LivePaypal } from '../server/paypal/livePaypal.js'
import { MockPaypal } from '../server/paypal/mockPaypal.js'
import { RestKept } from '../server/paypal/restKept.js'
import { NOW, recordingPort } from './helpers.js'
import { errBody, json, lostResponse, makeLive, planBody, tokenOk } from './sdkHelpers.js'

// What the caller of the HTTP API would read, through the app's own central error handler.
function viaHandler(err) {
  let out = null
  const res = { status(code) { out = { status: code }; return this }, json(body) { out = { ...out, ...body } } }
  errorHandler(err, {}, res, () => {})
  return out
}

const patchWith = (response, opts = {}) => {
  const { live } = makeLive({ handler: () => (typeof response === 'function' ? response() : response), ...opts })
  return live.overrideSubscriptionPrice('I-1', 900).catch((err) => err)
}

test('a 422 reason reaches the caller: same status, the API reason in the response', async () => {
  const err = await patchWith(json(422, errBody('Price increase too large')))
  assert.deepEqual(viaHandler(err), { status: 422, success: false, message: 'The requested action could not be performed. Price increase too large' })
})

test('a 400 on createPlan reaches the caller with its reason', async () => {
  const { live } = makeLive({ handler: () => json(400, errBody('Invalid price', 'INVALID_PARAMETER_VALUE')) })
  const err = await live.createPlan({ productId: 'PROD-1', name: 'N', interval: 'MONTH', priceCents: 1200 }).catch((e) => e)
  const out = viaHandler(err)
  assert.equal(out.status, 400)
  assert.match(out.message, /Invalid price/)
})

test('401 and 403 become 502 with a fixed message that does not blame the caller', async () => {
  for (const status of [401, 403]) {
    const out = viaHandler(await patchWith(json(status, errBody('secret detail'))))
    assert.equal(out.status, 502)
    assert.equal(out.message, "PayPal rejected this app's credentials.")
    assert.doesNotMatch(out.message, /secret detail/)
  }
})

test('429 becomes 503 and 500 becomes 502, both with fixed messages', async () => {
  const limited = viaHandler(await patchWith(json(429, errBody('slow down'))))
  assert.deepEqual([limited.status, limited.message], [503, 'PayPal is rate limiting this app. Try again shortly.'])
  // A 5xx on a read. On a write a 5xx may have been applied, so it goes to the UNKNOWN OUTCOMES path (next test).
  const { live } = makeLive({ handler: () => json(500, errBody('boom')) })
  const down = viaHandler(await live.getPlan('P-1').catch((e) => e))
  assert.deepEqual([down.status, down.message], [502, 'PayPal had an error.'])
})

test('a 5xx on a write is a possible write: it is settled by a re-read, and stays unknown when the re-read shows nothing', async () => {
  const { live, calls } = makeLive({
    handler: (call) => (call.method === 'PATCH' ? json(500, errBody('boom')) : call.path.includes('/plans/') ? json(200, planBody()) : json(200, { id: 'I-1', plan_id: 'P-1', status: 'ACTIVE' })),
  })
  const err = await live.overrideSubscriptionPrice('I-1', 900).catch((e) => e)
  assert.equal(err.code, 'OUTCOME_UNKNOWN')
  assert.ok(calls.some((c) => c.method === 'GET'))
})

test('an unreadable success body is a 502 with a fixed message (read)', async () => {
  const { live } = makeLive({ handler: () => json(200, planBody({ id: 42 })) })
  const err = await live.getPlan('P-1').catch((e) => e)
  assert.deepEqual([err.status, err.code], [502, 'PAYPAL_UNREADABLE'])
})

test('a truncated success body is not treated as a plan', async () => {
  const { live } = makeLive({ handler: () => json(200, {}) })
  const err = await live.getPlan('P-1').catch((e) => e)
  assert.equal(err.code, 'PAYPAL_UNREADABLE')
})

test('a dropped connection on a read is a 502 with a fixed message', async () => {
  const { live } = makeLive({ handler: lostResponse })
  const out = viaHandler(await live.getPlan('P-1').catch((e) => e))
  assert.deepEqual([out.status, out.message], [502, 'PayPal could not be reached.'])
})

test('reads keep the SDK retry: a 503 then a 200 returns the plan', async () => {
  let n = 0
  const { live, calls } = makeLive({
    retry: { delay: 0, maxJitter: 0 },
    handler: () => { n += 1; return n === 1 ? json(503, errBody('busy')) : json(200, planBody()) },
  })
  const plan = await live.getPlan('P-1')
  assert.equal(plan.id, 'P-1')
  assert.equal(calls.length, 2)
})

test('a refused token is a credentials error, never a failed business call', async () => {
  const { live } = makeLive({ handler: () => json(200, planBody()), tokenResponse: () => json(401, { error: 'invalid_client' }) })
  const err = await live.getPlan('P-1').catch((e) => e)
  assert.deepEqual([err.status, err.code], [502, 'AUTH_FAILED'])
})

// ---------- startup and host guards ----------

test('the adapter refuses to start without credentials and names the missing key', () => {
  assert.throws(() => new LivePaypal({ clientId: '', clientSecret: 's' }), /PAYPAL_CLIENT_ID is not configured/)
  assert.throws(() => new LivePaypal({ clientId: 'i', clientSecret: '' }), /PAYPAL_CLIENT_SECRET is not configured/)
})

test('the adapter refuses any host other than the sandbox', () => {
  assert.throws(() => new LivePaypal({ clientId: 'i', clientSecret: 's', baseUrl: 'https://api-m.paypal.com' }), /only runs against the PayPal sandbox/)
})

// ---------- kept on REST ----------

function restWith(responses) {
  const seen = []
  const fetchImpl = async (url, init) => {
    seen.push({ url, init })
    return responses.shift()
  }
  return { rest: new RestKept({ baseUrl: 'https://api-m.sandbox.paypal.com', clientId: 'i', clientSecret: 's', webhookId: 'WH-1', fetchImpl }), seen }
}

test('createProduct stays on REST: token request, then POST /v1/catalogs/products', async () => {
  const { rest, seen } = restWith([tokenOk(), json(201, { id: 'PROD-7' })])
  assert.equal(await rest.createProduct({ name: 'Demo' }), 'PROD-7')
  assert.equal(seen[0].url, 'https://api-m.sandbox.paypal.com/v1/oauth2/token')
  assert.equal(seen[1].url, 'https://api-m.sandbox.paypal.com/v1/catalogs/products')
  assert.equal(JSON.parse(seen[1].init.body).type, 'SERVICE')
})

test('verifyWebhook stays on REST and reads verification_status', async () => {
  const headers = { 'paypal-auth-algo': 'a', 'paypal-cert-url': 'c', 'paypal-transmission-id': 't', 'paypal-transmission-sig': 's', 'paypal-transmission-time': 'x' }
  const ok = restWith([tokenOk(), json(200, { verification_status: 'SUCCESS' })])
  assert.equal(await ok.rest.verifyWebhook(headers, { id: 'E-1' }), true)
  assert.equal(JSON.parse(ok.seen[1].init.body).webhook_id, 'WH-1')
  const bad = restWith([tokenOk(), json(200, { verification_status: 'FAILURE' })])
  assert.equal(await bad.rest.verifyWebhook(headers, { id: 'E-1' }), false)
})

// ---------- CROSS-OPERATION INVARIANT ----------

test('a step outside the bundle is rejected and no write is made', async () => {
  const mock = new MockPaypal({ clock: () => NOW })
  const bundle = await mock.seedBundle({ seededAt: NOW })
  const { port, log } = recordingPort(mock)
  const plan = {
    strategy: 'A',
    perSub: {},
    window: { minDays: 7, maxDays: 30 },
    steps: [{ phase: 'now', kind: 'override', subId: 'I-NOT-IN-THIS-BUNDLE', label: 'X', priceCents: 900 }],
  }
  const result = await executePlan({ port, plan, bundle, now: NOW })
  assert.equal(result.ok, false)
  assert.match(result.error, /outside this bundle/)
  const writeCalls = log.filter((l) => ['overrideSubscriptionPrice', 'updatePlanPrice', 'createPlan'].includes(l.call))
  assert.equal(writeCalls.length, 0)
})

test('assertStepsInBundle rejects a plan price step for a plan outside the bundle', () => {
  const snapshot = { subs: [{ id: 'S-1' }], plans: [{ id: 'P-1' }] }
  assert.doesNotThrow(() => assertStepsInBundle({ steps: [{ kind: 'plan_price', planId: 'P-1' }, { kind: 'create_plan', interval: 'MONTH' }] }, snapshot))
  assert.throws(() => assertStepsInBundle({ steps: [{ kind: 'plan_price', planId: 'P-OTHER' }] }, snapshot), /outside this bundle/)
})
