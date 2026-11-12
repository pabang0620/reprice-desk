import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cycle, empty, errBody, json, lostResponse, makeLive, planBody, subBody, writes } from './sdkHelpers.js'

// Header names the SDK adds on its own (identity, auth, content type, idempotency) plus the ones our rows require.
const SDK_HEADERS = new Set(['authorization', 'content-type', 'accept', 'user-agent', 'idempotency-key', 'prefer', 'paypal-request-id'])
const sdkOwned = (name) => SDK_HEADERS.has(name) || name.startsWith('x-apimatic-') || name === 'accept-encoding'

const route = (table) => (call) => {
  const hit = table[`${call.method} ${call.path}`]
  if (!hit) throw new Error(`unexpected request ${call.method} ${call.path}`)
  return typeof hit === 'function' ? hit(call) : hit.clone()
}

test('getPlan reads GET /v1/billing/plans/{id} and sends nothing we did not set', async () => {
  const { live, calls } = makeLive({ handler: route({ 'GET /v1/billing/plans/P-1': json(200, planBody()) }) })
  const plan = await live.getPlan('P-1')
  assert.deepEqual({ id: plan.id, interval: plan.interval, priceCents: plan.priceCents }, { id: 'P-1', interval: 'MONTH', priceCents: 1200 })
  assert.equal(calls.length, 1)
  assert.equal([...calls[0].query.keys()].length, 0)
  for (const name of calls[0].headers.keys()) assert.ok(sdkOwned(name), `unexpected header ${name}`)
})

test('getSubscription asks for fields=plan and uses the overridden price when the member is overridden', async () => {
  const sub = subBody({ plan_overridden: true, plan: { billing_cycles: [cycle('9.00')] } })
  const { live, calls } = makeLive({
    handler: route({ 'GET /v1/billing/subscriptions/I-1': json(200, sub), 'GET /v1/billing/plans/P-1': json(200, planBody()) }),
  })
  const read = await live.getSubscription('I-1')
  assert.equal(read.priceCents, 900)
  assert.equal(read.planOverridden, true)
  assert.equal(calls[0].query.get('fields'), 'plan')
  assert.deepEqual([...calls[0].query.keys()], ['fields'])
})

test('listSubscriptions sends only plan_ids, statuses, page_size and the SDK default page', async () => {
  const { live, calls } = makeLive({
    handler: route({
      'GET /v1/billing/subscriptions': json(200, { subscriptions: [subBody()] }),
      'GET /v1/billing/plans/P-1': json(200, planBody()),
      'GET /v1/billing/plans/P-2': json(200, planBody({ id: 'P-2' })),
    }),
  })
  const rows = await live.listSubscriptions({ planIds: ['P-1', 'P-2'] })
  assert.equal(rows.length, 1)
  const list = calls.find((c) => c.path === '/v1/billing/subscriptions')
  // `page` is the SDK's own default (1). The three below are ours.
  assert.deepEqual([...list.query.keys()].sort(), ['page', 'page_size', 'plan_ids', 'statuses'])
  assert.equal(list.query.get('plan_ids'), 'P-1,P-2')
  assert.equal(list.query.get('statuses'), 'ACTIVE')
})

test('listTransactions passes the required window and maps the gross amount to cents', async () => {
  const tx = { transactions: [{ id: 'T-1', time: '2026-11-01T00:00:00Z', amount_with_breakdown: { gross_amount: money('12.00') } }] }
  const { live, calls } = makeLive({ handler: route({ 'GET /v1/billing/subscriptions/I-1/transactions': json(200, tx) }) })
  const rows = await live.listTransactions('I-1', { startTime: '2026-10-01T00:00:00Z', endTime: '2026-11-12T00:00:00Z' })
  assert.deepEqual(rows, [{ amountCents: 1200 }])
  assert.equal(calls[0].query.get('start_time'), '2026-10-01T00:00:00Z')
})

function money(value) {
  return { currency_code: 'USD', value }
}

test('patchSubscription body: one replace of the fixed price, wire keys inside the free record, no extra headers', async () => {
  const { live, calls } = makeLive({ handler: route({ 'PATCH /v1/billing/subscriptions/I-1': empty() }) })
  await live.overrideSubscriptionPrice('I-1', 900)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].body, [{ op: 'replace', path: '/plan/billing_cycles/@sequence==1/pricing_scheme/fixed_price', value: { currency_code: 'USD', value: '9.00' } }])
  for (const name of calls[0].headers.keys()) assert.ok(sdkOwned(name), `unexpected header ${name}`)
  assert.equal(calls[0].headers.get('paypal-request-id'), null)
})

test('updatePlanPrice body: pricing scheme of cycle 1 only', async () => {
  const { live, calls } = makeLive({ handler: route({ 'POST /v1/billing/plans/P-1/update-pricing-schemes': empty() }) })
  await live.updatePlanPrice('P-1', 1200)
  assert.deepEqual(calls[0].body, { pricing_schemes: [{ billing_cycle_sequence: 1, pricing_scheme: { fixed_price: money('12.00') } }] })
})

test('createPlan body: one regular cycle that renews forever, request id from the claim, no invented payment preferences', async () => {
  const { live, calls } = makeLive({
    handler: route({ 'POST /v1/billing/plans': json(201, { id: 'P-9', status: 'ACTIVE' }), 'GET /v1/billing/plans/P-9': json(200, planBody({ id: 'P-9' })) }),
  })
  const plan = await live.createPlan({ productId: 'PROD-1', name: 'Monthly $12.00 (new signups)', interval: 'MONTH', priceCents: 1200 })
  assert.equal(plan.id, 'P-9')
  const post = calls.find((c) => c.method === 'POST')
  assert.equal(post.body.product_id, 'PROD-1')
  assert.equal(post.body.billing_cycles.length, 1)
  assert.equal(post.body.billing_cycles[0].total_cycles, 0)
  assert.equal(post.body.billing_cycles[0].tenure_type, 'REGULAR')
  assert.deepEqual(post.body.billing_cycles[0].pricing_scheme.fixed_price, money('12.00'))
  assert.match(post.headers.get('paypal-request-id'), /^reprice-[0-9a-f]{32}$/)
  // payment_preferences carries only the SDK's own schema defaults. The old explicit threshold of 3 is gone.
  assert.notEqual(post.body.payment_preferences?.payment_failure_threshold, 3)
  assert.notEqual(post.body.payment_preferences?.setup_fee_failure_action, 'CONTINUE')
})

test('createSubscription body: plan, start, custom id, return urls and NO_SHIPPING only', async () => {
  const created = { id: 'I-9', links: [{ href: 'https://sandbox.paypal.com/approve', rel: 'approve', method: 'GET' }] }
  const { live, calls } = makeLive({ handler: route({ 'POST /v1/billing/subscriptions': json(201, created) }) })
  const out = await live.createSubscription({ planId: 'P-1', startTime: '2026-11-20T00:00:00Z', customId: 'founder|2024-11|launch', reference: 'F1' })
  assert.deepEqual(out, { id: 'I-9', approveUrl: 'https://sandbox.paypal.com/approve' })
  // auto_renewal is the SDK's own schema default; everything else is ours.
  assert.deepEqual(Object.keys(calls[0].body).sort(), ['application_context', 'auto_renewal', 'custom_id', 'plan_id', 'start_time'])
  assert.equal(calls[0].body.application_context.shipping_preference, 'NO_SHIPPING')
})

// ---------- DUPLICATE CLAIMS ----------

test('the claim exists when the write request leaves (read from inside the fake fetch)', async () => {
  let seen = null
  const handlerCalls = []
  const holder = {}
  const { live } = makeLive({
    handler: route({ 'PATCH /v1/billing/subscriptions/I-1': empty() }),
    onCall: (call) => {
      handlerCalls.push(call.method)
      if (call.method === 'PATCH') seen = holder.live.claims.stateOf('override:I-1:900')
    },
  })
  holder.live = live
  await live.overrideSubscriptionPrice('I-1', 900)
  assert.equal(seen, 'pending')
  assert.equal(live.claims.stateOf('override:I-1:900'), 'done')
})

test('two identical concurrent writes reach PayPal once', async () => {
  const { live, calls } = makeLive({ handler: route({ 'PATCH /v1/billing/subscriptions/I-1': empty() }) })
  await Promise.all([live.overrideSubscriptionPrice('I-1', 900), live.overrideSubscriptionPrice('I-1', 900)])
  assert.equal(writes(calls).length, 1)
  await live.overrideSubscriptionPrice('I-1', 900)
  assert.equal(writes(calls).length, 1)
})

test('duplicate claims also stop a repeated plan price change, plan create and subscription create', async () => {
  const { live, calls } = makeLive({
    handler: route({
      'POST /v1/billing/plans/P-1/update-pricing-schemes': empty(),
      'POST /v1/billing/plans': json(201, { id: 'P-9' }),
      'GET /v1/billing/plans/P-9': json(200, planBody({ id: 'P-9' })),
      'POST /v1/billing/subscriptions': json(201, { id: 'I-9' }),
    }),
  })
  const plan = { productId: 'PROD-1', name: 'N', interval: 'MONTH', priceCents: 1200 }
  const sub = { planId: 'P-1', startTime: '2026-11-20T00:00:00Z', customId: 'c', reference: 'F1' }
  await Promise.all([live.updatePlanPrice('P-1', 1200), live.updatePlanPrice('P-1', 1200)])
  await Promise.all([live.createPlan(plan), live.createPlan(plan)])
  await Promise.all([live.createSubscription(sub), live.createSubscription(sub)])
  assert.equal(writes(calls).length, 3)
  // A different member with the same cohort tag is a different write.
  await live.createSubscription({ ...sub, reference: 'F2' })
  assert.equal(writes(calls).length, 4)
})

test('a 422 refusal releases the claim, so a later attempt reaches PayPal again', async () => {
  let attempt = 0
  const { live, calls } = makeLive({
    handler: route({ 'PATCH /v1/billing/subscriptions/I-1': () => { attempt += 1; return attempt === 1 ? json(422, errBody()) : empty() } }),
  })
  await assert.rejects(() => live.overrideSubscriptionPrice('I-1', 900), (err) => err.status === 422)
  assert.equal(live.claims.has('override:I-1:900'), false)
  await live.overrideSubscriptionPrice('I-1', 900)
  assert.equal(writes(calls).length, 2)
})

// ---------- UNKNOWN OUTCOMES ----------

test('patch lost response: the member is re-read, and a matching price settles the write', async () => {
  const sub = subBody({ plan_overridden: true, plan: { billing_cycles: [cycle('9.00')] } })
  const { live, calls } = makeLive({
    handler: route({
      'PATCH /v1/billing/subscriptions/I-1': lostResponse,
      'GET /v1/billing/subscriptions/I-1': json(200, sub),
      'GET /v1/billing/plans/P-1': json(200, planBody()),
    }),
  })
  await live.overrideSubscriptionPrice('I-1', 900)
  assert.equal(writes(calls).length, 1)
  assert.ok(calls.some((c) => c.method === 'GET' && c.path === '/v1/billing/subscriptions/I-1'))
  assert.equal(live.claims.stateOf('override:I-1:900'), 'done')
})

test('patch lost response and the re-read does not show the change: outcome unknown, never failed, and no second PATCH', async () => {
  const { live, calls } = makeLive({
    handler: route({
      'PATCH /v1/billing/subscriptions/I-1': lostResponse,
      'GET /v1/billing/subscriptions/I-1': json(200, subBody()),
      'GET /v1/billing/plans/P-1': json(200, planBody()),
    }),
  })
  await assert.rejects(() => live.overrideSubscriptionPrice('I-1', 900), (err) => err.code === 'OUTCOME_UNKNOWN' && err.status === 502)
  await assert.rejects(() => live.overrideSubscriptionPrice('I-1', 900), (err) => err.code === 'OUTCOME_UNKNOWN')
  assert.equal(writes(calls).length, 1)
  assert.equal(live.claims.stateOf('override:I-1:900'), 'unknown')
})

test('patch lost response and the re-read itself fails: still unknown', async () => {
  const { live } = makeLive({
    handler: route({ 'PATCH /v1/billing/subscriptions/I-1': lostResponse, 'GET /v1/billing/subscriptions/I-1': lostResponse }),
  })
  await assert.rejects(() => live.overrideSubscriptionPrice('I-1', 900), (err) => err.code === 'OUTCOME_UNKNOWN')
})

test('plan price lost response: the plan is re-read and settles when the price matches', async () => {
  const { live, calls } = makeLive({
    handler: route({
      'POST /v1/billing/plans/P-1/update-pricing-schemes': lostResponse,
      'GET /v1/billing/plans/P-1': json(200, planBody()),
    }),
  })
  await live.updatePlanPrice('P-1', 1200)
  assert.ok(calls.some((c) => c.method === 'GET' && c.path === '/v1/billing/plans/P-1'))
  await assert.rejects(() => live.updatePlanPrice('P-1', 1500), (err) => err.code === 'OUTCOME_UNKNOWN')
})

test('createPlan lost response: the product plan list is searched by name and the found plan settles the write', async () => {
  const name = 'Monthly $12.00 (new signups)'
  const { live, calls } = makeLive({
    handler: route({
      'POST /v1/billing/plans': lostResponse,
      'GET /v1/billing/plans': json(200, { plans: [{ id: 'P-0', name: 'other' }, { id: 'P-9', name }] }),
      'GET /v1/billing/plans/P-9': json(200, planBody({ id: 'P-9', name })),
    }),
  })
  const plan = await live.createPlan({ productId: 'PROD-1', name, interval: 'MONTH', priceCents: 1200 })
  assert.equal(plan.id, 'P-9')
  assert.equal(writes(calls).length, 1)
  const list = calls.find((c) => c.path === '/v1/billing/plans' && c.method === 'GET')
  assert.equal(list.query.get('product_id'), 'PROD-1')
})

test('createPlan lost response and no such plan in the list: outcome unknown', async () => {
  const { live } = makeLive({
    handler: route({ 'POST /v1/billing/plans': lostResponse, 'GET /v1/billing/plans': json(200, { plans: [] }) }),
  })
  await assert.rejects(() => live.createPlan({ productId: 'PROD-1', name: 'N', interval: 'MONTH', priceCents: 1200 }), (err) => err.code === 'OUTCOME_UNKNOWN')
})

test('createSubscription lost response: re-read by custom id and start time', async () => {
  const found = subBody({ id: 'I-7', custom_id: 'c', start_time: '2026-11-20T00:00:00Z', links: [{ href: 'https://x/approve', rel: 'approve', method: 'GET' }] })
  const { live } = makeLive({
    handler: route({ 'POST /v1/billing/subscriptions': lostResponse, 'GET /v1/billing/subscriptions': json(200, { subscriptions: [found] }) }),
  })
  const out = await live.createSubscription({ planId: 'P-1', startTime: '2026-11-20T00:00:00Z', customId: 'c', reference: 'F1' })
  assert.deepEqual(out, { id: 'I-7', approveUrl: 'https://x/approve' })
})

test('a 2xx create without an id is treated as unreadable, so the new plan is looked for, not reported as failed', async () => {
  const { live } = makeLive({
    handler: route({ 'POST /v1/billing/plans': json(201, {}), 'GET /v1/billing/plans': json(200, { plans: [] }) }),
  })
  await assert.rejects(() => live.createPlan({ productId: 'PROD-1', name: 'N', interval: 'MONTH', priceCents: 1200 }), (err) => err.code === 'OUTCOME_UNKNOWN')
})

test('never-sent failure (credential refused) on a write: the write is not re-read and the claim is released', async () => {
  const { live, calls } = makeLive({
    handler: route({}),
    tokenResponse: () => json(401, { error: 'invalid_client' }),
  })
  await assert.rejects(() => live.overrideSubscriptionPrice('I-1', 900), (err) => err.status === 502 && err.code === 'AUTH_FAILED')
  assert.equal(calls.length, 0)
  assert.equal(live.claims.has('override:I-1:900'), false)
})

test('never-sent failure (value the SDK refuses to encode) on a write: nothing is sent and nothing is re-read', async () => {
  const { live, calls } = makeLive({ handler: route({}) })
  await assert.rejects(() => live.overrideSubscriptionPrice(12345, 900), (err) => err.status === 500 && err.code === 'INTEGRATION_DEFECT')
  assert.equal(calls.length, 0)
})
