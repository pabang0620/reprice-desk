import { MockPaypal } from '../server/paypal/mockPaypal.js'
import { createDesk } from '../server/service.js'
import * as store from '../server/store.js'
import { SUBSCRIPTION_TEMPLATE, PLAN_SPECS } from '../server/domain/seedBundle.js'
import { addDays } from '../server/domain/dates.js'
import { parseCustomId } from '../server/domain/cohort.js'

export const NOW = new Date('2026-11-12T10:00:00Z')

// The 12 subscriptions from the seed table, as the pure functions see them.
export function seedSubs(now = NOW) {
  return SUBSCRIPTION_TEMPLATE.map((t) => {
    const plan = PLAN_SPECS[t.plan]
    return {
      id: `S-${t.label}`,
      label: t.label,
      planId: `P-${t.plan}`,
      interval: plan.interval,
      priceCents: plan.priceCents,
      overridden: false,
      nextCharge: addDays(now, t.offsetDays),
      daysToCharge: t.offsetDays,
      fundedBy: 'PAYPAL',
      ...parseCustomId(t.customId),
    }
  })
}

export const WINDOW = { minDays: 7, maxDays: 30 }
export const PRICES = { MONTH: 1200, YEAR: 12000 }
// What the operator types in the approval card (no price is prefilled).
export const PRICED = { monthly: 12, annual: 120 }

// Records every call so tests can check the order of PayPal writes and reads.
export function recordingPort(inner) {
  const log = []
  const port = new Proxy(inner, {
    get(target, prop) {
      const value = target[prop]
      if (typeof value !== 'function') return value
      return (...args) => {
        if (['overrideSubscriptionPrice', 'updatePlanPrice', 'createPlan', 'getSubscription'].includes(prop)) {
          log.push({ call: prop, args })
        }
        return value.apply(target, args)
      }
    },
  })
  return { port, log }
}

export async function makeDesk({ bundles = 2, mockOptions = {}, settings = {}, clock = () => NOW, record = false } = {}) {
  store.resetForTests()
  const mock = new MockPaypal({ clock, ...mockOptions })
  const recorded = record ? recordingPort(mock) : { port: mock, log: [] }
  const list = []
  for (let i = 0; i < bundles; i += 1) list.push(await mock.seedBundle({ seededAt: NOW }))
  store.addBundles(list)
  const desk = createDesk({ port: recorded.port, clock, settings })
  return { desk, mock, log: recorded.log }
}
