// Money is always integer cents. Prices never come from a model.
export function toCents(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) throw new Error(`Invalid amount: ${value}`)
  return Math.round(n * 100)
}

export function toValue(cents) {
  return (cents / 100).toFixed(2)
}

export function fmt(cents) {
  const sign = cents < 0 ? '-' : ''
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`
}

export function fmtDelta(cents) {
  return `${cents >= 0 ? '+' : '-'}$${(Math.abs(cents) / 100).toFixed(2)}`
}

export const MONTHS_IN_CYCLE = { MONTH: 1, YEAR: 12 }

// Monthly recurring revenue in cents for one subscription (annual plans are spread over 12 months).
export function monthlyCents(priceCents, interval) {
  return priceCents / MONTHS_IN_CYCLE[interval]
}
