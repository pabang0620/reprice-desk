import { startOfDay } from './domain/dates.js'
import { PLAN_SPECS, seededStartTimes } from './domain/seedBundle.js'

// Seeds one bundle: 1 product, 2 plans, 12 subscriptions. Works against any PayPal port.
// With the live port each subscription must be approved by a sandbox buyer (PayPal wallet), one at a time.
// `approve(approveUrl, label)` does that; the stand-in port has no approve link and skips it.
export async function seedBundle({ port, approve = null, seededAt = new Date(), waitActive = defaultWait }) {
  const productId = await port.createProduct({ name: `Reprice Desk demo ${seededAt.toISOString().slice(0, 10)}` })
  const plans = {}
  for (const spec of Object.values(PLAN_SPECS)) {
    plans[spec.key] = (await port.createPlan({ productId, name: spec.name, interval: spec.interval, priceCents: spec.priceCents })).id
  }
  const subscriptions = []
  for (const t of seededStartTimes(seededAt)) {
    const created = await port.createSubscription({ planId: plans[t.plan], startTime: t.startTime, customId: t.customId, reference: t.label })
    if (created.approveUrl) {
      if (!approve) throw new Error(`Subscription ${created.id} needs buyer approval but no approver was given.`)
      await approve(created.approveUrl, t.label)
      await waitActive(port, created.id)
    }
    subscriptions.push({ label: t.label, subId: created.id, planId: plans[t.plan] })
  }
  return {
    id: `B-${productId}`,
    productId,
    plans,
    subscriptions,
    seededAt: startOfDay(seededAt).toISOString(),
    createdAt: new Date().toISOString(),
  }
}

async function defaultWait(port, subId) {
  for (let i = 0; i < 20; i += 1) {
    const sub = await port.getSubscription(subId)
    if (sub.status === 'ACTIVE') return
    await new Promise((r) => setTimeout(r, 1500))
  }
  throw new Error(`Subscription ${subId} did not become ACTIVE after approval.`)
}
