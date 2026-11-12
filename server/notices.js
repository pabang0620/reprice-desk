import { addDays, iso } from './domain/dates.js'
import { fmt } from './domain/money.js'

// Notice text is filled by code: dates and prices come from the plan, never from a model.
export function noticeFor({ sub, decision, planName, now }) {
  const raised = decision && decision.targetCents > sub.priceCents && decision.action !== 'blocked'
  if (!raised) {
    return { member: sub.label, plan: planName, oldPrice: fmt(sub.priceCents), newPrice: fmt(sub.priceCents), changesOn: '', sendBy: iso(now), text: `Your ${planName} price stays at ${fmt(sub.priceCents)}, as we promised. You do not need to do anything.` }
  }
  const changesOn = iso(addDays(now, decision.firstChargeDays))
  const sendBy = iso(addDays(now, decision.runDay ?? 0))
  return {
    member: sub.label,
    plan: planName,
    oldPrice: fmt(sub.priceCents),
    newPrice: fmt(decision.targetCents),
    changesOn,
    sendBy,
    text: `Your ${planName} price changes from ${fmt(sub.priceCents)} to ${fmt(decision.targetCents)} starting with the charge on ${changesOn}. [Add how members can cancel before then.]`,
  }
}

export function allowedAmounts(subs, inputs) {
  const set = new Set([inputs.monthlyCents, inputs.annualCents, ...subs.map((s) => s.priceCents)])
  return new Set([...set].map((c) => fmt(c)))
}

// A model-written notice is accepted only if every dollar amount in it is one the code computed.
export function checkDraft(body, allowed) {
  const found = body.match(/\$\d[\d,]*(?:\.\d{2})?/g) || []
  const normalized = found.map((f) => (f.includes('.') ? f : `${f}.00`))
  const unknown = normalized.filter((f) => !allowed.has(f))
  return { ok: unknown.length === 0, unknown }
}

export function toCsv(rows) {
  const cols = ['member', 'plan', 'oldPrice', 'newPrice', 'changesOn', 'sendBy', 'text']
  const esc = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n')
}
