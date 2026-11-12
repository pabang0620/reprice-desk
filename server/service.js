import { randomUUID } from 'node:crypto'
import { cohortReport, COHORT_RULES } from './domain/cohort.js'
import { fmt, toCents } from './domain/money.js'
import { compareStrategies } from './domain/strategy.js'
import { buildCard, buildStudioData, cohortLabel, DEFAULT_RECOMMENDATION, metricRows, recommendationReason, strategyInput } from './view.js'
import { executePlan, runDueJobs } from './executor.js'
import { fingerprint, loadSnapshot } from './snapshot.js'
import { MockPaypal } from './paypal/mockPaypal.js'
import * as store from './store.js'
import { HttpError } from './http.js'
import { iso } from './domain/dates.js'
import { validateWindow } from './domain/strategy.js'

const locks = new Map()

// Money operations on one bundle run one at a time.
export function withLock(key, fn) {
  const previous = locks.get(key) || Promise.resolve()
  const next = previous.catch(() => {}).then(fn)
  locks.set(key, next)
  next.finally(() => { if (locks.get(key) === next) locks.delete(key) }).catch(() => {})
  return next
}

export function createDesk({ port, clock = () => new Date(), settings = {}, refillMock = null }) {
  const cfg = { v9: null, v4: null, cap: null, ...settings }
  const webhookLog = []
  port.onWebhook((event) => webhookLog.push(event))

  const need = (id) => {
    const session = store.getSession(id)
    if (!session) throw new HttpError(404, 'Session not found. Reload the page.')
    return session
  }
  const portOf = (session) => session.port || port
  const bundleOf = (session) => session.readOnlyBundle || store.getBundle(session.bundleId) || session.bundleCopy
  const keepLease = (session) => { if (!session.readOnly && session.bundleId) store.renewLease(session.bundleId, session.id, clock()) }

  async function startSession() {
    if (refillMock) await refillMock()
    const session = store.createSession()
    const bundle = store.leaseBundle(session.id, clock())
    if (bundle) {
      session.bundleId = bundle.id
      session.bundleCopy = { ...bundle }
      return session
    }
    // No fresh bundle: a read-only copy of the seed lets the judge reach Plan & compare without any PayPal write.
    const sandbox = new MockPaypal({ clock })
    session.port = sandbox
    session.readOnly = true
    session.readOnlyBundle = await sandbox.seedBundle({ seededAt: clock() })
    return session
  }

  async function snapshotOf(session) {
    return loadSnapshot({ port: portOf(session), bundle: bundleOf(session), now: clock() })
  }

  function compareOf(session, snapshot) {
    const input = strategyInput({ session, snapshot, now: clock(), settings: cfg })
    return input ? compareStrategies(input) : null
  }

  async function view(sessionId) {
    const session = need(sessionId)
    const snapshot = await snapshotOf(session)
    // After a run the frozen, executed plan is the source, so raised members are not read back as Kept.
    const executedPlan = session.execution ? session.plans.get(session.execution.planId) : null
    const compare = executedPlan?.compare || compareOf(session, snapshot)
    const bundle = bundleOf(session)
    const ids = new Set([...bundle.subscriptions.map((s) => s.subId), ...Object.values(bundle.plans), ...(session.execution?.newPlans || []).map((p) => p.planId)])
    const webhooks = webhookLog.filter((w) => ids.has(w.resourceId)).map((w) => ({ at: w.at, type: w.type, resourceId: w.resourceId }))
    const cohort = cohortReport(snapshot.subs)
    const planA = session.execution?.strategy
    // Before a run the cohort follows the strategy chosen on the approval card, so Kept and Raised match the card.
    const chosen = planA || session.approval?.strategy || session.strategy
    return {
      sessionId: session.id,
      readOnly: Boolean(session.readOnly),
      mode: session.readOnly ? 'read-only copy' : port.mode,
      now: iso(clock()),
      bundle: { id: bundle.id, seededAt: bundle.seededAt, status: session.readOnly ? 'read-only' : store.getBundle(bundle.id)?.status },
      freshBundlesLeft: store.freshBundlesLeft(clock()),
      subs: snapshot.subs.map((s) => ({ ...s, nextCharge: iso(s.nextCharge), cohort: cohortLabel(compare, s.id, chosen) })),
      plans: snapshot.plans,
      cohort,
      rule: session.rule,
      ruleDraft: session.ruleDraft,
      inputs: session.inputs,
      strategy: session.strategy,
      recommended: DEFAULT_RECOMMENDATION,
      recommendedReason: compare ? recommendationReason(compare, DEFAULT_RECOMMENDATION) : null,
      findings: { v9: cfg.v9, v4: cfg.v4, cap: cfg.cap },
      compare: compare ? { rows: metricRows(compare), A: summarize(compare.A), B: summarize(compare.B) } : null,
      cards: compare ? { A: buildCard(compare.A, session), B: buildCard(compare.B, session) } : null,
      approval: session.approval ? publicApproval(session.approval) : null,
      execution: session.execution,
      jobs: session.jobs,
      webhooks,
      studio: buildStudioData({ snapshot, compare, session, now: clock(), webhooks, executedStrategy: planA, cohortStrategy: chosen }),
    }
  }

  const summarize = (r) => ({ strategy: r.strategy, metrics: r.metrics, mrr: r.mrr, raiseCount: r.raiseCount, keepCount: r.keepCount, outsideSubs: r.outsideSubs, expectedWebhooks: r.expectedWebhooks, notes: r.notes, schedule: r.steps.filter((s) => s.phase === 'scheduled') })
  const publicApproval = (a) => ({ planId: a.planId, strategy: a.strategy, status: a.status, createdAt: a.createdAt })

  function setRule(sessionId, ruleId) {
    const session = need(sessionId)
    if (!COHORT_RULES[ruleId]) throw new HttpError(400, `Unknown rule ${ruleId}.`)
    if (session.execution) throw new HttpError(409, 'This bundle already ran. Open a new one.')
    session.rule = ruleId
    keepLease(session)
    session.approval = null
    return session
  }

  function setInputs(sessionId, input) {
    const session = need(sessionId)
    if (session.execution) throw new HttpError(409, 'This bundle already ran. Open a new one.')
    const next = {
      monthlyCents: input.monthly != null ? toCents(input.monthly) : session.inputs.monthlyCents,
      annualCents: input.annual != null ? toCents(input.annual) : session.inputs.annualCents,
      minDays: input.minDays ?? session.inputs.minDays,
      maxDays: input.maxDays ?? session.inputs.maxDays,
      overrideOutside: input.overrideOutside ?? Boolean(session.inputs.overrideOutside),
    }
    // Checked against the merged values before anything is stored, so a bad window never breaks the session.
    try {
      validateWindow({ minDays: next.minDays, maxDays: next.maxDays })
    } catch (err) {
      throw new HttpError(400, err.message)
    }
    session.inputs = next
    keepLease(session)
    session.approval = null
    return session
  }

  function chooseStrategy(sessionId, strategy) {
    const session = need(sessionId)
    session.strategy = strategy
    return session
  }

  // Freezes a plan: what will be written, in which order, against which subscriber state.
  async function prepareApproval(sessionId, strategy) {
    const session = need(sessionId)
    if (!session.rule) throw new HttpError(409, 'Pick who to keep first.')
    const snapshot = await snapshotOf(session)
    const compare = compareOf(session, snapshot)
    const result = compare[strategy]
    const plan = { ...result, id: randomUUID(), window: { minDays: session.inputs.minDays, maxDays: session.inputs.maxDays }, fingerprint: fingerprint(snapshot.subs), planId: null }
    plan.planId = plan.id
    plan.compare = compare
    session.plans.set(plan.id, plan)
    keepLease(session)
    session.strategy = strategy
    session.approval = { planId: plan.id, strategy, status: 'ready', createdAt: clock().toISOString() }
    return { planId: plan.id, card: buildCard(result, session) }
  }

  // Approve & run. Re-reads the subscribers: if they changed since the plan was frozen, nothing is written.
  async function approveAndRun(sessionId, planId) {
    const session = need(sessionId)
    if (session.readOnly) throw new HttpError(403, 'No fresh sandbox bundle left. Watch the recorded run.')
    const bundle = bundleOf(session)
    return withLock(bundle.id, async () => {
      const plan = session.plans.get(planId)
      if (!plan) throw new HttpError(404, 'Plan not found. Prepare the approval card again.')
      if (session.executedPlanIds.has(planId) || session.execution) throw new HttpError(409, 'This plan already ran. A used bundle is read-only.')
      if (session.approval?.planId !== planId || session.approval.status !== 'ready') throw new HttpError(409, 'This is not the current approval card. Prepare the approval again.')
      const snapshot = await snapshotOf(session)
      if (fingerprint(snapshot.subs) !== plan.fingerprint) {
        throw new HttpError(409, 'Review again: the subscribers changed after the plan was prepared. Nothing was written.')
      }
      // The bundle must still be leased by this session and unused. Checked and marked in one step.
      store.claimBundleForRun(bundle.id, session.id, clock())
      session.executedPlanIds.add(planId)
      session.approval = { ...session.approval, status: 'running' }
      const result = await executePlan({ port: portOf(session), plan, bundle, now: clock() })
      session.execution = { planId, strategy: plan.strategy, ...result, finishedAt: clock().toISOString() }
      session.jobs = result.jobs
      session.approval = { ...session.approval, status: result.ok ? 'done' : 'failed' }
      session.events.push({ at: clock().toISOString(), kind: 'execution', detail: `${plan.strategy}: ${result.ok ? 'all prices read back' : result.error}` })
      return session.execution
    })
  }

  async function runScheduler(sessionId = null, now = clock()) {
    const targets = sessionId ? [need(sessionId)] : store.allSessions()
    const out = []
    for (const session of targets) {
      if (!session.jobs.length || session.readOnly) continue
      const bundle = bundleOf(session)
      const outcomes = await withLock(bundle.id, () => runDueJobs({ port: portOf(session), jobs: session.jobs, done: session.jobsDone, now, minDays: session.inputs.minDays }))
      for (const o of outcomes) session.events.push({ at: now.toISOString(), kind: 'scheduled', detail: `${o.label}: ${o.status} (${o.detail})` })
      out.push(...outcomes)
    }
    return out
  }

  function receiveWebhook(event) {
    webhookLog.push({ id: event.id, type: event.event_type || event.type, resourceId: event.resource?.id || event.resourceId, at: event.create_time || new Date().toISOString() })
  }

  return { startSession, view, setRule, setInputs, chooseStrategy, prepareApproval, approveAndRun, runScheduler, receiveWebhook, snapshotOf, compareOf, need, settings: cfg, clock, fmt }
}
