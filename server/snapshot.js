import { createHash } from 'node:crypto'
import { parseCustomId } from './domain/cohort.js'
import { daysBetween, rollForward } from './domain/dates.js'

// Reads the bundle from PayPal and turns it into the shape the pure functions use.
export async function loadSnapshot({ port, bundle, now }) {
  const planIds = Object.values(bundle.plans)
  let rows
  try {
    rows = await port.listSubscriptions({ planIds })
  } catch {
    // V5 fallback: the list call is not available, read each subscription by id.
    rows = await Promise.all(bundle.subscriptions.map((s) => port.getSubscription(s.subId)))
  }
  const byId = new Map(rows.map((r) => [r.id, r]))
  const subs = []
  for (const entry of bundle.subscriptions) {
    const row = byId.get(entry.subId) || (await port.getSubscription(entry.subId))
    const interval = row.interval
    const nextCharge = rollForward(row.nextBillingTime, interval, now)
    subs.push({
      id: row.id,
      label: entry.label,
      planId: row.planId,
      interval,
      priceCents: row.priceCents,
      overridden: row.planOverridden,
      status: row.status,
      nextCharge,
      daysToCharge: daysBetween(now, nextCharge),
      fundedBy: row.fundedBy,
      lastPaymentCents: row.lastPaymentCents,
      ...parseCustomId(row.customId),
    })
  }
  const plans = await Promise.all(Object.entries(bundle.plans).map(async ([key, id]) => ({ key, ...(await port.getPlan(id)) })))
  return { subs, plans }
}

export function fingerprint(subs) {
  const rows = subs.map((s) => [s.id, s.planId, s.priceCents, s.overridden]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  return createHash('sha1').update(JSON.stringify(rows)).digest('hex')
}
