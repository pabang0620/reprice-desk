import { createHash } from 'node:crypto'
import { ExperienceContextShippingPreference, IntervalUnit, PaypalClient, PatchOp, TenureType } from 'paypal'
import { toCents, toValue } from '../domain/money.js'
import { PaypalError } from './errors.js'
import { regularCycle } from './normalize.js'
import { RestKept } from './restKept.js'
import { MESSAGES, outcomeUnknown, toPaypalError, writeFailureKind } from './sdkErrors.js'
import { WriteClaims } from './writeClaims.js'

// Live adapter on the APIMatic PayPal TypeScript SDK (package `paypal`). Contract sheet: paypal-plan.md.
// Used only when sandbox credentials are present. Catalog Products and webhook verification are not in the SDK
// and stay on REST (restKept.js). See VERIFY.md for the run order.
export const SANDBOX_BASE_URL = 'https://api-m.sandbox.paypal.com'
const FIXED_PRICE_PATH = '/plan/billing_cycles/@sequence==1/pricing_scheme/fixed_price'
const LIST_PAGE_SIZE = 20
const LIST_PAGE_LIMIT = 10

const unreadable = () => new PaypalError('PAYPAL_UNREADABLE', MESSAGES.unreadable, 502)
const shortHash = (text) => createHash('sha1').update(text).digest('hex').slice(0, 32)

// A response member the decoder lets through as optional but this app cannot work without.
function need(value) {
  if (value === undefined || value === null) throw unreadable()
  return value
}

export class LivePaypal {
  constructor({ clientId, clientSecret, webhookId = '', baseUrl = SANDBOX_BASE_URL, fetchImpl, retry = {}, claims = new WriteClaims() }) {
    // An unset credential is not an SDK error (it 401s later), so the app refuses to start without it.
    if (!clientId) throw new Error('PAYPAL_CLIENT_ID is not configured.')
    if (!clientSecret) throw new Error('PAYPAL_CLIENT_SECRET is not configured.')
    // The SDK has one environment and no selector. This app only talks to the sandbox, so any other host is refused.
    if (baseUrl !== SANDBOX_BASE_URL) throw new Error(`Reprice Desk only runs against the PayPal sandbox (${SANDBOX_BASE_URL}).`)
    this.mode = 'sandbox'
    this.claims = claims
    this.client = new PaypalClient({
      serverOptions: { baseUrl },
      oauth2: { clientId, clientSecret },
      // 20 s per attempt. Reads keep the SDK default of 3 retries. POST and PATCH are not in the default retry gate,
      // so every write is sent once; unknown outcomes are settled by re-reading, not by resending.
      retry: { timeout: 20000, ...retry },
      // Set explicitly so PAYPAL_CLIENT_LOG cannot switch logging on from outside the code.
      logging: { level: 'off' },
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
    })
    this.subscriptions = this.client.subscriptions
    this.rest = new RestKept({ baseUrl, clientId, clientSecret, webhookId, ...(fetchImpl ? { fetchImpl } : {}) })
  }

  onWebhook() {}

  // ---------- reads ----------

  async #read(fn) {
    try {
      return await fn()
    } catch (err) {
      throw toPaypalError(err)
    }
  }

  async getPlan(planId) {
    const plan = await this.#read(() => this.subscriptions.getBillingPlan({ id: planId }))
    return this.#planView(plan)
  }

  #planView(plan) {
    const id = need(plan.id)
    const cycle = regularCycle(plan.billingCycles)
    const price = need(cycle?.pricingScheme?.fixedPrice?.value)
    return {
      id,
      productId: plan.productId,
      name: plan.name,
      interval: cycle?.frequency?.intervalUnit === IntervalUnit.Year ? 'YEAR' : 'MONTH',
      priceCents: toCents(price),
      status: plan.status,
      versions: [{ version: cycle?.pricingScheme?.version ?? 1, priceCents: toCents(price), at: plan.updateTime || plan.createTime }],
    }
  }

  // plansById lets a list call read each plan once instead of once per subscription.
  async getSubscription(subId, plansById = null) {
    const sub = await this.#read(() => this.subscriptions.getSubscription({ id: subId, fields: 'plan' }))
    return this.#subscriptionView(sub, plansById)
  }

  async #subscriptionView(sub, plansById) {
    const id = need(sub.id)
    const planId = need(sub.planId)
    const plan = plansById?.get(planId) || (await this.getPlan(planId))
    const cycle = regularCycle(sub.plan?.billingCycles)
    const overridden = Boolean(sub.planOverridden)
    const detailPrice = cycle?.pricingScheme?.fixedPrice?.value
    return {
      id,
      planId,
      status: sub.status,
      customId: sub.customId || '',
      nextBillingTime: sub.billingInfo?.nextBillingTime || sub.startTime,
      planOverridden: overridden,
      priceCents: overridden && detailPrice != null ? toCents(detailPrice) : plan.priceCents,
      // The billing interval belongs to the plan. The subscription detail may omit the plan for subscriptions that were not overridden.
      interval: plan.interval,
      fundedBy: 'PAYPAL',
      lastPaymentCents: sub.billingInfo?.lastPayment?.amount?.value != null ? toCents(sub.billingInfo.lastPayment.amount.value) : null,
    }
  }

  // listSubscriptions exists only in the Server SDK, not in the public OpenAPI file (V5). One call, pageSize 20 (100 is refused in sandbox, V5): a bundle has 12 members.
  async listSubscriptions({ planIds }) {
    const list = await this.#read(() => this.subscriptions.listSubscriptions({ planIds: planIds.join(','), statuses: 'ACTIVE', pageSize: 20 }))
    const plans = new Map(await Promise.all(planIds.map(async (id) => [id, await this.getPlan(id)])))
    return Promise.all((list.subscriptions || []).map((s) => this.#subscriptionView(s, plans)))
  }

  async listTransactions(subId, { startTime, endTime }) {
    const list = await this.#read(() => this.subscriptions.listSubscriptionTransactions({ id: subId, startTime, endTime }))
    return (list.transactions || []).map((t) => ({ amountCents: toCents(t.amountWithBreakdown.grossAmount.value) }))
  }

  // ---------- writes: claim, SDK call, record ----------

  // key: what every caller of the same write computes the same. send: the SDK call. settle: the re-read for an unknown outcome.
  async #write({ key, send, settle }) {
    const { won, entry } = this.claims.begin(key)
    if (!won) {
      // A repeat of the same write. It never reaches PayPal: it uses what the winner recorded, or settles an unknown claim first.
      if (entry.state === 'unknown') return this.#settleUnknown(key, settle)
      if (entry.state === 'done') return entry.result
      return entry.settled
    }
    let result
    try {
      result = await send()
    } catch (err) {
      return this.#afterFailure({ key, err, settle })
    }
    this.claims.done(key, result)
    return result
  }

  async #afterFailure({ key, err, settle }) {
    if (writeFailureKind(err) === 'refused') {
      const mapped = toPaypalError(err)
      this.claims.release(key, mapped)
      throw mapped
    }
    // PayPal may have acted. Keep the claim and settle from what PayPal holds; never report "failed".
    this.claims.markUnknown(key, outcomeUnknown())
    return this.#settleUnknown(key, settle)
  }

  async #settleUnknown(key, settle) {
    let found
    try {
      found = await settle()
    } catch {
      throw outcomeUnknown()
    }
    if (found === undefined) throw outcomeUnknown()
    this.claims.settle(key, found.value)
    return found.value
  }

  async createPlan({ productId, name, interval, priceCents }) {
    const key = `plan:${productId}:${name}:${interval}:${priceCents}`
    // The claim records only the new plan id. The read-back of the full plan happens after the write is settled.
    const created = await this.#write({
      key,
      send: async () => {
        const created = await this.subscriptions.createBillingPlan({
          payPalRequestId: `reprice-${shortHash(key)}`,
          body: {
            productId,
            name,
            billingCycles: [
              {
                frequency: { intervalUnit: interval === 'YEAR' ? IntervalUnit.Year : IntervalUnit.Month },
                tenureType: TenureType.Regular,
                sequence: 1,
                totalCycles: 0,
                pricingScheme: { fixedPrice: { currencyCode: 'USD', value: toValue(priceCents) } },
              },
            ],
            paymentPreferences: {},
          },
        })
        return { id: need(created.id) }
      },
      settle: () => this.#findPlanByName({ productId, name }),
    })
    return this.getPlan(created.id)
  }

  // Re-read for createPlan: the plan list of the product is read in full (bounded) and matched on the unique plan name.
  async #findPlanByName({ productId, name }) {
    for (let page = 1; page <= LIST_PAGE_LIMIT; page += 1) {
      const list = await this.subscriptions.listBillingPlans({ productId, pageSize: LIST_PAGE_SIZE, page })
      const plans = list.plans || []
      const hit = plans.find((p) => p.name === name)
      if (hit?.id) return { value: { id: hit.id } }
      if (plans.length < LIST_PAGE_SIZE) return undefined
    }
    return undefined
  }

  async overrideSubscriptionPrice(subId, priceCents) {
    await this.#write({
      key: `override:${subId}:${priceCents}`,
      send: async () => {
        await this.subscriptions.patchSubscription({
          id: subId,
          body: [{ op: PatchOp.Replace, path: FIXED_PRICE_PATH, value: { currency_code: 'USD', value: toValue(priceCents) } }],
        })
        return true
      },
      settle: async () => {
        const read = await this.getSubscription(subId)
        return read.planOverridden && read.priceCents === priceCents ? { value: true } : undefined
      },
    })
  }

  async updatePlanPrice(planId, priceCents) {
    await this.#write({
      key: `planprice:${planId}:${priceCents}`,
      send: async () => {
        await this.subscriptions.updateBillingPlanPricingSchemes({
          id: planId,
          body: { pricingSchemes: [{ billingCycleSequence: 1, pricingScheme: { fixedPrice: { currencyCode: 'USD', value: toValue(priceCents) } } }] },
        })
        return true
      },
      settle: async () => ((await this.getPlan(planId)).priceCents === priceCents ? { value: true } : undefined),
    })
  }

  // `reference` tells two members with the same cohort tag apart (the seed passes the label). It is part of the claim key.
  async createSubscription({ planId, startTime, customId, reference, returnUrl = 'https://example.com/return', cancelUrl = 'https://example.com/cancel' }) {
    const key = `sub:${planId}:${reference ?? customId}:${startTime}`
    return this.#write({
      key,
      send: async () => {
        const created = await this.subscriptions.createSubscription({
          payPalRequestId: `reprice-${shortHash(key)}`,
          body: {
            planId,
            startTime,
            customId,
            applicationContext: { returnUrl, cancelUrl, shippingPreference: ExperienceContextShippingPreference.NoShipping },
          },
        })
        return { id: need(created.id), approveUrl: (created.links || []).find((l) => l.rel === 'approve')?.href }
      },
      settle: () => this.#findSubscription({ planId, customId, startTime }),
    })
  }

  // Re-read for createSubscription: the plan's subscriptions, matched on custom id and start time. Two matches are ambiguous, so unknown.
  async #findSubscription({ planId, customId, startTime }) {
    const list = await this.subscriptions.listSubscriptions({ planIds: planId, pageSize: 20 })
    const hits = (list.subscriptions || []).filter((s) => s.customId === customId && s.startTime && new Date(s.startTime).getTime() === new Date(startTime).getTime())
    if (hits.length !== 1) return undefined
    const hit = hits[0]
    return { value: { id: need(hit.id), approveUrl: (hit.links || []).find((l) => l.rel === 'approve')?.href } }
  }

  // ---------- kept on REST (not in the SDK) ----------

  createProduct(args) {
    return this.rest.createProduct(args)
  }

  verifyWebhook(headers, body) {
    return this.rest.verifyWebhook(headers, body)
  }
}
