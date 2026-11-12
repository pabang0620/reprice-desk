// Seeds sandbox bundles (12 subscriptions each) into BUNDLES_FILE. One at a time: parallel buyer logins fail.
//   node scripts/seedBundles.js --count 16 --confirm     real sandbox calls, buyer approval in a headless browser
//   node scripts/seedBundles.js --count 2 --dry-run      stand-in PayPal, no network, shows the same code path
// Run it again every day while judging is open: bundles older than BUNDLE_MAX_AGE_DAYS are never leased.
import { appendFileSync, mkdirSync } from 'node:fs'
import { config, modes } from '../server/config.js'
import { LivePaypal } from '../server/paypal/livePaypal.js'
import { MockPaypal } from '../server/paypal/mockPaypal.js'
import { seedBundle } from '../server/seed.js'
import * as store from '../server/store.js'
import { createBrowserApprover } from './lib/approve.js'

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const count = Number(args[args.indexOf('--count') + 1] || 1)
const dryRun = flag('--dry-run')

if (!dryRun && !flag('--confirm')) {
  process.stderr.write('Refusing to call PayPal without --confirm. Use --dry-run to try the code path on the stand-in.\n')
  process.exit(2)
}
if (!dryRun && modes.paypal !== 'sandbox') {
  process.stderr.write('Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (sandbox app) first.\n')
  process.exit(2)
}
if (!config.bundlesFile && !dryRun) {
  process.stderr.write('Set BUNDLES_FILE so bundles survive a restart.\n')
  process.exit(2)
}

const port = dryRun ? new MockPaypal() : new LivePaypal({ clientId: config.paypalClientId, clientSecret: config.paypalClientSecret })
const approver = dryRun ? null : await createBrowserApprover({ email: process.env.SANDBOX_BUYER_EMAIL, password: process.env.SANDBOX_BUYER_PASSWORD })
store.loadBundles([])
mkdirSync('docs', { recursive: true })

try {
  for (let i = 0; i < count; i += 1) {
    const started = Date.now()
    const bundle = await seedBundle({ port, approve: approver ? (url, label) => approver.approve(url, label) : null })
    store.addBundles([bundle])
    const seconds = Math.round((Date.now() - started) / 1000)
    process.stdout.write(`bundle ${i + 1}/${count}: ${bundle.id} in ${seconds}s\n`)
    // V2 measurement: seconds per bundle of 12 subscriptions.
    if (!dryRun) appendFileSync('docs/seed-timing.log', `${new Date().toISOString()} ${bundle.id} ${seconds}s\n`)
  }
} finally {
  await approver?.close()
}
