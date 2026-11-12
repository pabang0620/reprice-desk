import { Router } from 'express'
import { z } from 'zod'
import { config, modes } from './config.js'
import * as store from './store.js'
import { HttpError, parse, sessionIdSchema } from './http.js'
import { buildNoticeRows, createAgentTools, TOOL_NAMES } from './agentTools.js'
import { toCsv } from './notices.js'
import { runLlmTurn } from './studio/llm.js'
import { MockPaypal } from './paypal/mockPaypal.js'
import { LivePaypal } from './paypal/livePaypal.js'
import { createDesk } from './service.js'
import { DEFAULT_RECOMMENDATION } from './view.js'
import { createLlmLimiter } from './studio/limits.js'

const idParams = z.object({ id: sessionIdSchema })
const ruleBody = z.object({ rule: z.enum(['tag', 'signup', 'source']) }).strict()
// Whole cents only: 0.001 would silently become zero cents.
const price = (max) => z.number().min(0.01).max(max).refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'at most two decimals')
const inputsBody = z.object({
  monthly: price(10000).optional(),
  annual: price(100000).optional(),
  minDays: z.number().int().min(1).max(60).optional(),
  maxDays: z.number().int().min(10).max(90).optional(),
  overrideOutside: z.boolean().optional(),
}).strict().refine((v) => v.minDays == null || v.maxDays == null || v.minDays <= v.maxDays, { message: 'minDays must not be larger than maxDays', path: ['minDays'] })
const strategyBody = z.object({ strategy: z.enum(['A', 'B']) }).strict()
const runBody = z.object({ planId: z.string().uuid() }).strict()
const toolParams = z.object({ id: sessionIdSchema, tool: z.enum(TOOL_NAMES) })
const llmBody = z.object({ sessionId: sessionIdSchema, request: z.object({ input: z.array(z.any()), instructions: z.string().optional(), tools: z.array(z.any()).optional(), toolChoice: z.any().optional(), responseFormat: z.any(), model: z.any().optional() }).passthrough() })

// Live PayPal sandbox when credentials exist, otherwise the in-memory stand-in with the same rules.
export function createPort() {
  if (modes.paypal === 'sandbox') return new LivePaypal({ clientId: config.paypalClientId, clientSecret: config.paypalClientSecret, webhookId: config.paypalWebhookId })
  return new MockPaypal()
}

export function createApp(deps = {}) {
  const port = deps.port || createPort()
  const isMock = port.mode === 'mock'
  const desk = createDesk({
    port,
    settings: {
      v9: config.v9KeptReceivePlanEmail,
      v4: config.v4PatchSendsEmail,
      cap: config.capPct ? { pct: config.capPct, days: config.capDays, mode: 'clamp' } : null,
    },
    // The stand-in has no seeding cost, so it always keeps fresh bundles ready.
    refillMock: isMock ? async () => {
      while (store.freshBundlesLeft() < config.mockBundleCount && store.totalBundles() < config.bundleStoreMax) store.addBundles([await port.seedBundle()])
    } : null,
  })
  const tools = createAgentTools(desk)
  const llmLimiter = deps.llmLimiter || createLlmLimiter()
  const router = Router()
  const guard = (fn) => async (req, res, next) => {
    try {
      await fn(req, res)
    } catch (err) {
      next(err)
    }
  }

  router.get('/health', (req, res) => res.json({ success: true, data: { modes, bundles: store.bundleCounts() } }))

  router.get('/config', (req, res) => res.json({
    success: true,
    data: { modes: { ...modes, paypal: port.mode }, studioLicenseKey: config.studioLicenseKey, freshBundlesLeft: store.freshBundlesLeft(), findings: desk.settings, defaultRecommendation: DEFAULT_RECOMMENDATION },
  }))

  router.post('/session', guard(async (req, res) => {
    const session = await desk.startSession()
    res.status(201).json({ success: true, data: { sessionId: session.id, readOnly: Boolean(session.readOnly) } })
  }))

  router.get('/session/:id', guard(async (req, res) => {
    const { id } = parse(idParams, req.params)
    res.json({ success: true, data: await desk.view(id) })
  }))

  router.put('/session/:id/rule', guard(async (req, res) => {
    const { id } = parse(idParams, req.params)
    desk.setRule(id, parse(ruleBody, req.body).rule)
    res.json({ success: true, data: await desk.view(id) })
  }))

  router.put('/session/:id/inputs', guard(async (req, res) => {
    const { id } = parse(idParams, req.params)
    desk.setInputs(id, parse(inputsBody, req.body))
    res.json({ success: true, data: await desk.view(id) })
  }))

  router.post('/session/:id/approval', guard(async (req, res) => {
    const { id } = parse(idParams, req.params)
    const { strategy } = parse(strategyBody, req.body)
    res.status(201).json({ success: true, data: await desk.prepareApproval(id, strategy) })
  }))

  router.post('/session/:id/run', guard(async (req, res) => {
    const { id } = parse(idParams, req.params)
    const { planId } = parse(runBody, req.body)
    await desk.approveAndRun(id, planId)
    res.json({ success: true, data: await desk.view(id) })
  }))

  router.post('/session/:id/scheduler/run', guard(async (req, res) => {
    const { id } = parse(idParams, req.params)
    const outcomes = await desk.runScheduler(id)
    res.json({ success: true, data: { outcomes, view: await desk.view(id) } })
  }))

  router.get('/session/:id/notices.csv', guard(async (req, res) => {
    const { id } = parse(idParams, req.params)
    const session = desk.need(id)
    const snapshot = await desk.snapshotOf(session)
    const compare = desk.compareOf(session, snapshot)
    if (!compare) throw new HttpError(409, 'Pick who to keep first.')
    res.type('text/csv').send(toCsv(buildNoticeRows({ snapshot, compare, session, now: desk.clock() })))
  }))

  router.post('/session/:id/agent/:tool', guard(async (req, res) => {
    const { id, tool } = parse(toolParams, req.params)
    res.json({ success: true, data: await tools.run(id, tool, req.body) })
  }))

  router.post('/studio/llm', guard(async (req, res) => {
    const { request, sessionId } = parse(llmBody, req.body)
    desk.need(sessionId)
    llmLimiter.take(sessionId)
    res.json({ success: true, data: { response: await runLlmTurn(request) } })
  }))

  router.post('/webhooks/paypal', guard(async (req, res) => {
    if (port.mode === 'sandbox' && !(await port.verifyWebhook(req.headers, req.body))) throw new HttpError(400, 'Webhook signature check failed.')
    desk.receiveWebhook(req.body)
    res.json({ success: true })
  }))

  return { router, desk, port }
}
