import { LivePaypal } from '../server/paypal/livePaypal.js'

// Fake fetch for the APIMatic SDK seam (ClientOptions.fetch). The SDK passes one Request and no init.
// Bodies in the stubs below are in WIRE shape (snake_case), because the SDK decodes every response.
export const TOKEN_PATH = '/v1/oauth2/token'

export const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
export const empty = (status = 204) => new Response(null, { status })
export const tokenOk = () => json(200, { access_token: 'T', token_type: 'Bearer', expires_in: 3600 })

export const money = (value) => ({ currency_code: 'USD', value })

export const cycle = (value, version = 1) => ({
  frequency: { interval_unit: 'MONTH', interval_count: 1 },
  tenure_type: 'REGULAR',
  sequence: 1,
  total_cycles: 0,
  pricing_scheme: { version, fixed_price: money(value) },
})

export const planBody = (over = {}) => ({
  id: 'P-1', product_id: 'PROD-1', name: 'Monthly', status: 'ACTIVE', billing_cycles: [cycle('12.00')], update_time: '2026-11-12T00:00:00Z', ...over,
})

export const subBody = (over = {}) => ({
  id: 'I-1',
  plan_id: 'P-1',
  status: 'ACTIVE',
  custom_id: 'founder|2024-11|launch',
  start_time: '2026-11-20T00:00:00Z',
  plan_overridden: false,
  billing_info: { outstanding_balance: money('0.00'), failed_payments_count: 0, next_billing_time: '2026-11-20T00:00:00Z' },
  ...over,
})

export const errBody = (message = 'Price increase too large', issue = 'PRICING_SCHEME_UPDATE_NOT_ALLOWED') => ({
  name: 'UNPROCESSABLE_ENTITY', message: 'The requested action could not be performed.', debug_id: 'dbg-1', details: [{ issue, description: message }],
})

// handler(call) -> Response | throws. The token request is answered first and is not counted in `calls`.
export function makeLive({ handler, onCall = null, retry = { maxRetries: 0 }, tokenResponse = tokenOk } = {}) {
  const calls = []
  const fetchImpl = async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    if (url.pathname === TOKEN_PATH) return tokenResponse()
    const text = request.body === null ? undefined : await request.clone().text()
    const call = { method: request.method, path: url.pathname, query: url.searchParams, headers: request.headers, body: text === undefined ? undefined : safeParse(text), raw: text }
    calls.push(call)
    onCall?.(call)
    return handler(call)
  }
  const live = new LivePaypal({ clientId: 'id', clientSecret: 'secret', fetchImpl, retry })
  return { live, calls, fetchImpl }
}

function safeParse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export const lostResponse = () => {
  throw new Error('ECONNRESET')
}

export const writes = (calls) => calls.filter((c) => c.method !== 'GET')
