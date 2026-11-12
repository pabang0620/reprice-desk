// V18: does a keep-override PATCH apply when the next charge is within 10 days? Sandbox only, used bundles only.
//   node scripts/tenDayOverrideCheck.js --bundle <used bundle id> --labels F1,R1 --confirm
// PATCHes each named member to its current price (no price change), waits, reads it back twice.
import { readFileSync } from 'node:fs'
import { config, modes } from '../server/config.js'
import { LivePaypal } from '../server/paypal/livePaypal.js'
import { daysBetween } from '../server/domain/dates.js'

const args = process.argv.slice(2)
const arg = (name) => args[args.indexOf(name) + 1]
if (!args.includes('--confirm') || modes.paypal !== 'sandbox') {
  process.stderr.write('Needs sandbox credentials and --confirm.\n')
  process.exit(2)
}
const bundle = JSON.parse(readFileSync(config.bundlesFile, 'utf8')).find((b) => b.id === arg('--bundle'))
if (!bundle || bundle.status !== 'used') {
  process.stderr.write('Name a bundle that is already used (never a fresh one).\n')
  process.exit(2)
}
const live = new LivePaypal({ clientId: config.paypalClientId, clientSecret: config.paypalClientSecret })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const show = (label, r) => `${label}: next charge in ${daysBetween(new Date(), new Date(r.nextBillingTime))} days, price ${r.priceCents}, plan_overridden=${r.planOverridden}`

for (const label of arg('--labels').split(',')) {
  const entry = bundle.subscriptions.find((s) => s.label === label)
  const before = await live.getSubscription(entry.subId)
  process.stdout.write(`before ${show(label, before)}\n`)
  try {
    await live.overrideSubscriptionPrice(entry.subId, before.priceCents)
    process.stdout.write(`${label}: PATCH accepted\n`)
  } catch (err) {
    process.stdout.write(`${label}: PATCH result ${err.code || ''} ${err.message}\n`)
  }
  await wait(5000)
  process.stdout.write(`after 5 s ${show(label, await live.getSubscription(entry.subId))}\n`)
  await wait(30000)
  process.stdout.write(`after 35 s ${show(label, await live.getSubscription(entry.subId))}\n`)
}
