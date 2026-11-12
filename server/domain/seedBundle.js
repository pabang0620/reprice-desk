import { addDays } from './dates.js'

// One bundle = 1 product, 2 plans, 12 subscriptions. A bundle is used once and then locked,
// because a subscription override cannot be removed through the API.
export const PLAN_SPECS = {
  monthly: { key: 'monthly', name: 'Pro Monthly', interval: 'MONTH', priceCents: 900 },
  annual: { key: 'annual', name: 'Pro Annual', interval: 'YEAR', priceCents: 9000 },
}

// custom_id = tag|signup_month|source. offsetDays counts from the day the bundle was seeded.
export const SUBSCRIPTION_TEMPLATE = [
  // F1 is charged 16 days out, so a kept founder can be pinned on seed day: PayPal does not apply an override
  // inside 10 days (VERIFY V18), and strategy A waits until every kept member is past that point.
  { label: 'F1', plan: 'monthly', customId: 'founder|2024-11|launch', offsetDays: 16 },
  { label: 'F2', plan: 'monthly', customId: 'founder|2024-12|launch', offsetDays: 14 },
  { label: 'F3', plan: 'monthly', customId: 'founder|2025-01|launch', offsetDays: 22 },
  { label: 'F4', plan: 'monthly', customId: 'founder|2025-01|referral', offsetDays: 29 },
  { label: 'R1', plan: 'monthly', customId: 'regular|2025-06|web', offsetDays: 4 },
  { label: 'R2', plan: 'monthly', customId: 'regular|2025-08|web', offsetDays: 12 },
  { label: 'R3', plan: 'monthly', customId: 'regular|2025-11|web', offsetDays: 20 },
  { label: 'R4', plan: 'monthly', customId: 'regular|2025-01|web', offsetDays: 27 },
  { label: 'A1', plan: 'annual', customId: 'regular|2025-03|web', offsetDays: 45 },
  { label: 'A2', plan: 'annual', customId: 'regular|2025-05|web', offsetDays: 120 },
  { label: 'A3', plan: 'annual', customId: 'founder|2024-12|web', offsetDays: 60 },
  { label: 'A4', plan: 'annual', customId: 'founder|2025-01|web', offsetDays: 200 },
]

export function seededStartTimes(seededAt) {
  return SUBSCRIPTION_TEMPLATE.map((t) => ({ ...t, startTime: addDays(seededAt, t.offsetDays).toISOString() }))
}
