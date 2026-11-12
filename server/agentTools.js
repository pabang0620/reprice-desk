import { z } from 'zod'
import { COHORT_RULES, cohortReport } from './domain/cohort.js'
import { fmt, toCents } from './domain/money.js'
import { iso } from './domain/dates.js'
import { allowedAmounts, checkDraft, noticeFor } from './notices.js'
import { metricRows, DEFAULT_RECOMMENDATION } from './view.js'
import { HttpError, parse } from './http.js'

const ruleId = z.enum(['tag', 'signup', 'source'])
const schemas = {
  scan_subscribers: z.object({}).strict(),
  propose_cohort_rules: z.object({ rules: z.array(z.object({ id: ruleId, reason: z.string().max(400).optional() })).min(1).max(3), selected: ruleId.optional() }).strict(),
  compare_strategies: z.object({ plan_draft: z.object({ monthly: z.union([z.number(), z.string()]).optional(), annual: z.union([z.number(), z.string()]).optional(), note: z.string().max(400).optional() }).partial().optional(), preference: z.enum(['no_checkout_change', 'no_emails_to_kept', 'none']).optional() }).strict(),
  get_schedule_preview: z.object({ strategy: z.enum(['A', 'B']).optional() }).strict(),
  draft_notice: z.object({ cohort: z.enum(['raise', 'keep']), body: z.string().min(10).max(1200) }).strict(),
  get_execution_report: z.object({}).strict(),
}

export const TOOL_NAMES = Object.keys(schemas)

// Tools the Studio agent calls. None of them writes to PayPal and none accepts a price: the operator's card inputs are the only source.
export function createAgentTools(desk) {
  const handlers = {}

  handlers.scan_subscribers = async (session) => {
    const snapshot = await desk.snapshotOf(session)
    const report = cohortReport(snapshot.subs)
    return {
      readOnly: true,
      rules: Object.values(COHORT_RULES).map((r) => ({ id: r.id, label: r.label, members: report.byRule[r.id] })),
      conflictCount: report.conflicts.length,
      conflicts: report.conflicts,
      subscribers: snapshot.subs.map((s) => ({ label: s.label, cycle: s.interval, price: fmt(s.priceCents), tag: s.tag, signupMonth: s.signupMonth, source: s.source, nextCharge: iso(s.nextCharge), daysToCharge: s.daysToCharge })),
      confirmedRule: session.rule,
    }
  }

  handlers.propose_cohort_rules = async (session, args) => {
    session.ruleDraft = { rules: args.rules, selected: args.selected || null, savedAt: desk.clock().toISOString() }
    return { saved: true, note: 'Draft only. The operator confirms the rule in the desk before any number is computed.', draft: session.ruleDraft }
  }

  handlers.compare_strategies = async (session, args) => {
    if (!session.rule) return { error: 'The operator has not confirmed a cohort rule yet. Ask them, call propose_cohort_rules, and wait for them to confirm in the desk.' }
    const snapshot = await desk.snapshotOf(session)
    const compare = desk.compareOf(session, snapshot)
    const warnings = []
    const draft = args.plan_draft || {}
    for (const [key, own] of [['monthly', session.inputs.monthlyCents], ['annual', session.inputs.annualCents]]) {
      if (draft[key] != null && toCents(draft[key]) !== own) {
        warnings.push(`Ignored drafted ${key} price ${fmt(toCents(draft[key]))}. The operator's input ${fmt(own)} is used.`)
      }
    }
    const rows = metricRows(compare)
    return {
      pricesUsed: { monthly: fmt(session.inputs.monthlyCents), annual: fmt(session.inputs.annualCents), noticeWindowDays: [session.inputs.minDays, session.inputs.maxDays] },
      warnings,
      rows: rows.map((r) => ({ metric: r.label, A: r.A, B: r.B })),
      defaultRecommendation: args.preference === 'no_checkout_change' ? 'A' : DEFAULT_RECOMMENDATION,
      outsideWindowA: compare.A.outsideSubs,
      notes: [...compare.A.notes, ...compare.B.notes],
      findings: { v9PlanEmailToKept: desk.settings.v9, v4PatchEmail: desk.settings.v4 },
    }
  }

  handlers.get_schedule_preview = async (session, args) => {
    const snapshot = await desk.snapshotOf(session)
    const compare = desk.compareOf(session, snapshot)
    if (!compare) return { error: 'No cohort rule confirmed yet.' }
    const strategy = args.strategy || session.strategy || DEFAULT_RECOMMENDATION
    return {
      strategy,
      scheduled: compare[strategy].steps.filter((s) => s.phase === 'scheduled').map((s) => ({ member: s.label, runOn: s.runOn, day: s.day, firstChargeOn: s.firstChargeOn, noticeDays: s.noticeDays, price: fmt(s.targetCents) })),
      tenDayShifted: compare[strategy].shiftedSubs,
      outsideWindow: compare[strategy].outsideSubs,
    }
  }

  handlers.draft_notice = async (session, args) => {
    const snapshot = await desk.snapshotOf(session)
    const check = checkDraft(args.body, allowedAmounts(snapshot.subs, session.inputs))
    if (!check.ok) return { saved: false, warning: `Draft ignored. It contains amounts the code did not compute: ${check.unknown.join(', ')}. The code-filled template is used instead.` }
    session.noticeDrafts = { ...(session.noticeDrafts || {}), [args.cohort]: args.body }
    return { saved: true }
  }

  handlers.get_execution_report = async (session) => {
    if (!session.execution) return { executed: false }
    const e = session.execution
    return { executed: true, strategy: e.strategy, ok: e.ok, error: e.error, steps: e.steps.map((s) => `${s.kind} ${s.label}: ${s.status}`), readBack: e.readBack.map((r) => ({ member: r.label, price: fmt(r.priceCents), overridden: r.overridden, ok: r.ok })), newPlans: e.newPlans, scheduled: e.jobs.map((j) => ({ member: j.label, runOn: j.runOn })) }
  }

  return {
    async run(sessionId, name, rawArgs) {
      if (!schemas[name]) throw new HttpError(404, `Unknown tool ${name}.`)
      const args = parse(schemas[name], rawArgs ?? {})
      const session = desk.need(sessionId)
      return handlers[name](session, args)
    },
  }
}

export function buildNoticeRows({ snapshot, compare, session, now }) {
  const strategy = session.strategy || DEFAULT_RECOMMENDATION
  const planName = new Map(snapshot.plans.map((p) => [p.id, p.name]))
  return snapshot.subs.map((sub) => {
    const decision = compare[strategy].perSub[sub.id]
    const row = noticeFor({ sub, decision, planName: planName.get(sub.planId) || 'plan', now })
    const draft = session.noticeDrafts?.[decision && decision.targetCents > sub.priceCents ? 'raise' : 'keep']
    return draft ? { ...row, text: draft } : row
  })
}

