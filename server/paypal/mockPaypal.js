import { addDays, addMonths } from '../domain/dates.js'
import { seedBundle } from '../seed.js'
import { PaypalError } from './errors.js'

// Stand-in for PayPal Subscriptions with the same rules the plan relies on:
// - a plan price change reaches every subscription that has no override (D1, D2)
// - an override stays after later plan price changes and cannot be removed (D2)
// - an optional increase cap (V1 c) can be switched on to test the fallback
export class MockPaypal {
  constructor({ clock = () => new Date(), cap = null, failOverrideFor = [], rejectPlanUpdate = false } = {}) {
    this.mode = 'mock'
    this.clock = clock
    this.cap = cap
    this.failOverrideFor = new Set(failOverrideFor)
    this.rejectPlanUpdate = rejectPlanUpdate
    this.plans = new Map()
    this.subs = new Map()
    this.counter = 0
    this.webhookListeners = []
    this.calls = []
  }

  onWebhook(fn) {
    this.webhookListeners.push(fn)
  }

  nextId(prefix) {
    this.counter += 1
    return `${prefix}-MOCK${String(this.counter).padStart(5, '0')}`
  }

  emit(type, resourceId) {
    const event = { id: this.nextId('WH'), type, resourceId, at: this.clock().toISOString() }
    for (const fn of this.webhookListeners) fn(event)
  }

  record(call, detail) {
    this.calls.push({ call, ...detail })
  }

  async createPlan({ productId, name, interval, priceCents }) {
    const id = this.nextId('P')
    this.plans.set(id, { id, productId, name, interval, priceCents, status: 'ACTIVE', versions: [{ version: 1, priceCents, at: this.clock().toISOString() }] })
    this.record('createBillingPlan', { id, priceCents })
    return this.plans.get(id)
  }

  async getPlan(planId) {
    const plan = this.plans.get(planId)
    if (!plan) throw new PaypalError('RESOURCE_NOT_FOUND', `Plan ${planId} not found`, 404)
    return { id: plan.id, productId: plan.productId, name: plan.name, interval: plan.interval, priceCents: plan.priceCents, status: plan.status, versions: [...plan.versions] }
  }

  async createSubscription({ planId, startTime, customId }) {
    const plan = await this.getPlan(planId)
    const id = this.nextId('I')
    this.subs.set(id, { id, planId, status: 'ACTIVE', customId, nextBillingTime: new Date(startTime).toISOString(), overridePriceCents: null, fundedBy: 'PAYPAL', lastPaymentCents: null, interval: plan.interval })
    this.record('createSubscription', { id })
    return { id, approveUrl: null }
  }

  view(sub) {
    const plan = this.plans.get(sub.planId)
    return {
      id: sub.id,
      planId: sub.planId,
      status: sub.status,
      customId: sub.customId,
      nextBillingTime: sub.nextBillingTime,
      planOverridden: sub.overridePriceCents != null,
      priceCents: sub.overridePriceCents != null ? sub.overridePriceCents : plan.priceCents,
      interval: plan.interval,
      fundedBy: sub.fundedBy,
      lastPaymentCents: sub.lastPaymentCents,
    }
  }

  async getSubscription(subId) {
    const sub = this.subs.get(subId)
    if (!sub) throw new PaypalError('RESOURCE_NOT_FOUND', `Subscription ${subId} not found`, 404)
    return this.view(sub)
  }

  async listSubscriptions({ planIds }) {
    return [...this.subs.values()].filter((s) => planIds.includes(s.planId)).map((s) => this.view(s))
  }

  checkCap(oldCents, newCents, subject) {
    if (!this.cap || newCents <= oldCents) return
    if (newCents > Math.floor(oldCents * (1 + this.cap.pct / 100))) {
      throw new PaypalError('INVALID_PARAMETER_VALUE', `Increase above ${this.cap.pct} percent is not allowed for ${subject}`, 422)
    }
    const last = this.cap.lastIncrease?.get(subject)
    if (last && (this.clock() - last) / 86400000 < this.cap.days) {
      throw new PaypalError('INVALID_PARAMETER_VALUE', `Only one increase per ${this.cap.days} days for ${subject}`, 422)
    }
    if (this.cap.lastIncrease) this.cap.lastIncrease.set(subject, this.clock())
  }

  // PATCH /plan/billing_cycles/@sequence==1/pricing_scheme/fixed_price on one subscription.
  async overrideSubscriptionPrice(subId, priceCents) {
    const sub = this.subs.get(subId)
    if (!sub) throw new PaypalError('RESOURCE_NOT_FOUND', `Subscription ${subId} not found`, 404)
    if (this.failOverrideFor.has(subId)) throw new PaypalError('PERMISSION_DENIED', 'Billing Plan Override is not allowed due to insufficient permissions.', 403)
    const current = this.view(sub).priceCents
    this.checkCap(current, priceCents, subId)
    sub.overridePriceCents = priceCents
    this.record('patchSubscription', { id: subId, priceCents })
    this.emit('BILLING.SUBSCRIPTION.UPDATED', subId)
  }

  async updatePlanPrice(planId, priceCents) {
    const plan = this.plans.get(planId)
    if (!plan) throw new PaypalError('RESOURCE_NOT_FOUND', `Plan ${planId} not found`, 404)
    if (this.rejectPlanUpdate) throw new PaypalError('PRICING_SCHEME_UPDATE_NOT_ALLOWED', 'Pricing scheme update is not allowed for the plan.', 422)
    this.checkCap(plan.priceCents, priceCents, planId)
    plan.priceCents = priceCents
    plan.versions.push({ version: plan.versions.length + 1, priceCents, at: this.clock().toISOString() })
    this.record('updateBillingPlanPricingSchemes', { id: planId, priceCents })
    this.emit('BILLING.PLAN.PRICING-CHANGE.ACTIVATED', planId)
  }

  async listTransactions(subId) {
    const sub = this.subs.get(subId)
    return sub?.lastPaymentCents != null ? [{ amountCents: sub.lastPaymentCents }] : []
  }

  async createProduct() {
    return this.nextId('PROD')
  }

  // Seeds one bundle. The real script does the same with PayPal wallet buyer approval.
  async seedBundle({ seededAt = this.clock() } = {}) {
    const bundle = await seedBundle({ port: this, seededAt })
    this.calls = []
    return { ...bundle, id: this.nextId('B') }
  }

  // Test helper: pretend billing happened.
  advanceBilling(subId, days) {
    const sub = this.subs.get(subId)
    sub.nextBillingTime = addDays(sub.nextBillingTime, days).toISOString()
  }

  charge(subId) {
    const sub = this.subs.get(subId)
    sub.lastPaymentCents = this.view(sub).priceCents
    sub.nextBillingTime = addMonths(sub.nextBillingTime, sub.interval === 'YEAR' ? 12 : 1).toISOString()
  }
}
