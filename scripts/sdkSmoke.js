// SDK smoke (VERIFY.md item "SDK smoke"): read-only calls through the APIMatic SDK against the real sandbox credential.
//   node scripts/sdkSmoke.js --confirm
// Reads only: list one billing plan page and one subscription page. Nothing is created, changed or approved.
import { config, modes } from '../server/config.js'
import { LivePaypal } from '../server/paypal/livePaypal.js'

if (!process.argv.includes('--confirm')) {
  process.stderr.write('Refusing to call PayPal without --confirm.\n')
  process.exit(2)
}
if (modes.paypal !== 'sandbox') {
  process.stderr.write('Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (sandbox app) first.\n')
  process.exit(2)
}

const live = new LivePaypal({ clientId: config.paypalClientId, clientSecret: config.paypalClientSecret })
const plans = await live.subscriptions.listBillingPlans({ pageSize: 1 })
process.stdout.write(`listBillingPlans: ${plans.plans?.length ?? 0} plan(s) on page 1\n`)
if (plans.plans?.[0]?.id) {
  const plan = await live.getPlan(plans.plans[0].id)
  process.stdout.write(`getBillingPlan: ${plan.id} ${plan.interval} ${plan.priceCents} cents\n`)
}
const subs = await live.subscriptions.listSubscriptions({ pageSize: 1 })
process.stdout.write(`listSubscriptions: ${subs.subscriptions?.length ?? 0} subscription(s) on page 1\n`)
