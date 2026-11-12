const KEPT_ACTIONS = ['keep', 'keep_override', 'blocked']

// The one line that proves "founders untouched": the members kept at their old price, as read back from PayPal.
// Pure function of the read-back rows, so every figure comes from PayPal's answer.
export function keptSummary(readBack = []) {
  const kept = readBack.filter((r) => KEPT_ACTIONS.includes(r.action))
  if (!kept.length) return null
  const prices = [...new Set(kept.map((r) => `$${(r.priceCents / 100).toFixed(2)}`))]
  const flags = [...new Set(kept.map((r) => String(r.overridden)))]
  const allOk = kept.every((r) => r.ok && r.priceCents === r.expectedCents)
  return {
    ok: allOk,
    text: `Kept members unchanged: ${kept.map((r) => r.label).join(' ')} at ${prices.join(' / ')}, plan_overridden=${flags.join(' / ')} (read back from PayPal)`,
  }
}

export function chipTone(row) {
  if (!row.ok) return 'bad'
  return KEPT_ACTIONS.includes(row.action) ? 'kept' : 'raised'
}
