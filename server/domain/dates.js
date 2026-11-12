// All dates are handled as UTC calendar days so the numbers do not move with the server time zone.
const DAY_MS = 86400000

export function startOfDay(date) {
  const d = new Date(date)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

export function addDays(date, n) {
  return new Date(startOfDay(date).getTime() + n * DAY_MS)
}

export function addMonths(date, n) {
  const d = startOfDay(date)
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d.getUTCDate(), lastDay)))
}

export function daysBetween(from, to) {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY_MS)
}

export function iso(date) {
  return startOfDay(date).toISOString().slice(0, 10)
}

export function monthKey(date) {
  return iso(date).slice(0, 7)
}

export function addCycle(date, interval) {
  return interval === 'YEAR' ? addMonths(date, 12) : addMonths(date, 1)
}

export function cycleDays(date, interval) {
  return daysBetween(date, addCycle(date, interval))
}

// A billing date that is already in the past has been charged since the bundle was seeded.
// PayPal moves next_billing_time forward, so the desk rolls the date forward the same way.
export function rollForward(nextBilling, interval, now) {
  let next = startOfDay(nextBilling)
  const today = startOfDay(now)
  let guard = 0
  while (next < today && guard < 200) {
    next = addCycle(next, interval)
    guard += 1
  }
  return next
}
