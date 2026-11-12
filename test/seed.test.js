import test from 'node:test'
import assert from 'node:assert/strict'
import { seedBundle } from '../server/seed.js'
import { MockPaypal } from '../server/paypal/mockPaypal.js'
import { SUBSCRIPTION_TEMPLATE } from '../server/domain/seedBundle.js'
import { NOW } from './helpers.js'

test('seed creates 1 product, 2 plans and 12 subscriptions with the table custom ids', async () => {
  const mock = new MockPaypal({ clock: () => NOW })
  const bundle = await seedBundle({ port: mock, seededAt: NOW })
  assert.equal(Object.keys(bundle.plans).length, 2)
  assert.equal(bundle.subscriptions.length, 12)
  const f4 = bundle.subscriptions.find((s) => s.label === 'F4')
  const sub = await mock.getSubscription(f4.subId)
  assert.equal(sub.customId, SUBSCRIPTION_TEMPLATE.find((t) => t.label === 'F4').customId)
})

test('seed asks the approver once per subscription when PayPal returns an approve link', async () => {
  const mock = new MockPaypal({ clock: () => NOW })
  const original = mock.createSubscription.bind(mock)
  mock.createSubscription = async (args) => ({ ...(await original(args)), approveUrl: 'https://sandbox.example/approve' })
  const approved = []
  await seedBundle({ port: mock, seededAt: NOW, approve: async (url, label) => { approved.push(label) }, waitActive: async () => {} })
  assert.equal(approved.length, 12)
  await assert.rejects(() => seedBundle({ port: mock, seededAt: NOW, approve: null }), /needs buyer approval/)
})
