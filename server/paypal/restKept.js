import { PaypalError } from './errors.js'

// Operations the APIMatic SDK does not cover (see paypal-plan.md, "Not in the SDK, kept on REST"):
// Catalog Products and webhook signature verification. Plain REST against the sandbox host, with an injectable fetch for tests.
export class RestKept {
  constructor({ baseUrl, clientId, clientSecret, webhookId = '', fetchImpl = globalThis.fetch }) {
    this.baseUrl = baseUrl
    this.clientId = clientId
    this.clientSecret = clientSecret
    this.webhookId = webhookId
    this.fetch = fetchImpl
  }

  async accessToken() {
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')
    const res = await this.fetch(`${this.baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    })
    if (!res.ok) throw new PaypalError('AUTH_FAILED', `PayPal token request failed (${res.status})`, 502)
    return (await res.json()).access_token
  }

  async createProduct({ name }) {
    const token = await this.accessToken()
    const res = await this.fetch(`${this.baseUrl}/v1/catalogs/products`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': `reprice-product-${Date.now()}` },
      body: JSON.stringify({ name, type: 'SERVICE', category: 'SOFTWARE' }),
    })
    if (!res.ok) throw new PaypalError('PRODUCT_FAILED', `Product create failed (${res.status})`, 502)
    return (await res.json()).id
  }

  async verifyWebhook(headers, body) {
    if (!this.webhookId) return false
    const token = await this.accessToken()
    const res = await this.fetch(`${this.baseUrl}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_algo: headers['paypal-auth-algo'],
        cert_url: headers['paypal-cert-url'],
        transmission_id: headers['paypal-transmission-id'],
        transmission_sig: headers['paypal-transmission-sig'],
        transmission_time: headers['paypal-transmission-time'],
        webhook_id: this.webhookId,
        webhook_event: body,
      }),
    })
    if (!res.ok) return false
    return (await res.json()).verification_status === 'SUCCESS'
  }
}
