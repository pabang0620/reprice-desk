// V1 / V4 / V9 / V3 / V5 / V6 sandbox checks, in the order written in VERIFY.md.
//   node scripts/sandboxChecks.js --confirm     real sandbox calls (needs sandbox credentials and a sandbox buyer)
//   node scripts/sandboxChecks.js --dry-run     stand-in PayPal, shows the report format
// Writes request/response evidence to docs/sandbox-checks.md. Email checks (V9, V4) need a human to read the buyer inbox.
import { mkdirSync, writeFileSync } from 'node:fs'
import { config, modes } from '../server/config.js'
import { LivePaypal } from '../server/paypal/livePaypal.js'
import { MockPaypal } from '../server/paypal/mockPaypal.js'
import { addDays } from '../server/domain/dates.js'
import { fmt } from '../server/domain/money.js'
import { createBrowserApprover } from './lib/approve.js'

const dryRun = process.argv.includes('--dry-run')
if (!dryRun && !process.argv.includes('--confirm')) {
  process.stderr.write('Refusing to call PayPal without --confirm.\n')
  process.exit(2)
}
if (!dryRun && modes.paypal !== 'sandbox') {
  process.stderr.write('Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (sandbox app) first.\n')
  process.exit(2)
}

const port = dryRun ? new MockPaypal() : new LivePaypal({ clientId: config.paypalClientId, clientSecret: config.paypalClientSecret })
const approver = dryRun ? null : await createBrowserApprover({ email: process.env.SANDBOX_BUYER_EMAIL, password: process.env.SANDBOX_BUYER_PASSWORD })
const lines = [`# Sandbox checks (${dryRun ? 'stand-in dry run' : 'real sandbox'}) ${new Date().toISOString()}`, '']
const note = (text) => lines.push(text)

async function attempt(label, fn) {
  try {
    const value = await fn()
    note(`- ${label}: OK ${value === undefined ? '' : JSON.stringify(value)}`)
    return { ok: true, value }
  } catch (err) {
    note(`- ${label}: REJECTED ${err.code || ''} ${err.message}`)
    return { ok: false, error: err }
  }
}

async function activeSubscription(planId, label, startDays) {
  const created = await port.createSubscription({
    planId,
    startTime: addDays(new Date(), startDays).toISOString(),
    customId: `check|2025-01|web`,
    reference: label,
    returnUrl: 'https://example.com/return',
    cancelUrl: 'https://example.com/cancel',
  })
  if (created.approveUrl) {
    await approver.approve(created.approveUrl, label)
    for (let i = 0; i < 20; i += 1) {
      if ((await port.getSubscription(created.id)).status === 'ACTIVE') break
      await new Promise((r) => setTimeout(r, 1500))
    }
  }
  return created.id
}

try {
  const productId = await port.createProduct({ name: 'Reprice Desk checks' })
  const p1 = (await port.createPlan({ productId, name: 'Check P1', interval: 'MONTH', priceCents: 900 })).id
  const p2 = (await port.createPlan({ productId, name: 'Check P2', interval: 'MONTH', priceCents: 900 })).id
  const subA = await activeSubscription(p1, 'A (keep)', 20)
  const subB = await activeSubscription(p1, 'B (plain)', 21)
  const subC = await activeSubscription(p2, 'C (raise)', 22)
  note('## V3 / V5 / V7')
  await attempt('V5 listSubscriptions on P1', async () => (await port.listSubscriptions({ planIds: [p1] })).map((s) => s.id))
  await attempt('V3 next billing time of A (start_time + 20d)', async () => (await port.getSubscription(subA)).nextBillingTime)
  note('## V1 (a) keep-override, then plan price 9 -> 12')
  await attempt('PATCH A to the same price 9.00', () => port.overrideSubscriptionPrice(subA, 900))
  await attempt('plan P1 9.00 -> 12.00 (33 percent)', () => port.updatePlanPrice(p1, 1200))
  const a = await port.getSubscription(subA)
  const b = await port.getSubscription(subB)
  note(`- read back A: overridden=${a.planOverridden} price=${fmt(a.priceCents)} | B: overridden=${b.planOverridden} price=${fmt(b.priceCents)}`)
  note('## V1 (b) raise PATCH 9 -> 12 on C (plan P2 untouched)')
  const raise = await attempt('PATCH C to 12.00 (33 percent)', () => port.overrideSubscriptionPrice(subC, 1200))
  if (!raise.ok) {
    note('## V1 (c) cap probe on a NEW subscription: 20 percent, then a second 20 percent on the same subscription')
    const subD = await activeSubscription(p2, 'D (cap probe)', 23)
    const first = await attempt('PATCH D to 10.80 (20 percent)', () => port.overrideSubscriptionPrice(subD, 1080))
    if (first.ok) await attempt('PATCH D again to 12.96 (another 20 percent right away)', () => port.overrideSubscriptionPrice(subD, 1296))
  }
  note('## V6 transactions of A')
  await attempt('listSubscriptionTransactions', () => port.listTransactions(subA, { startTime: new Date(Date.now() - 86400000).toISOString(), endTime: new Date().toISOString() }))
  note('')
  note('Human steps: (V9) open the sandbox buyer inbox and note whether A received a plan price change email. (V4) note whether C received a PATCH email. (V10) check webhook delivery in the developer dashboard.')
} finally {
  await approver?.close()
  mkdirSync('docs', { recursive: true })
  writeFileSync('docs/sandbox-checks.md', `${lines.join('\n')}\n`)
  process.stdout.write(`${lines.join('\n')}\n`)
}
