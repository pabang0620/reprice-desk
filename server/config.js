import 'dotenv/config'

// A bad or missing number falls back to the default, so a typo in .env never disables a cap.
const num = (value, fallback) => (Number.isFinite(Number(value)) && String(value ?? '').trim() !== '' ? Number(value) : fallback)

const forceMock = process.env.FORCE_MOCK === '1'
const port = Number(process.env.PORT || 3002)

export const config = {
  port,
  anthropicKey: forceMock ? '' : process.env.ANTHROPIC_API_KEY || '',
  // LLM_BACKEND=account runs the model through the local Claude Code login (development only). The API key is never used then.
  llmBackend: forceMock ? 'mock' : process.env.LLM_BACKEND === 'account' ? 'account' : process.env.ANTHROPIC_API_KEY ? 'api' : 'mock',
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
  // Development only: append every real model turn to this transcript file (see builtin/recorded-runs).
  llmRecordFile: forceMock ? '' : process.env.LLM_RECORD_FILE || '',
  paypalClientId: forceMock ? '' : process.env.PAYPAL_CLIENT_ID || '',
  paypalClientSecret: forceMock ? '' : process.env.PAYPAL_CLIENT_SECRET || '',
  paypalWebhookId: process.env.PAYPAL_WEBHOOK_ID || '',
  studioLicenseKey: process.env.VITE_AG_STUDIO_LICENSE_KEY || process.env.AG_STUDIO_LICENSE_KEY || '',
  bundlesFile: process.env.BUNDLES_FILE || '',
  // Bundles older than this many days are never leased, so the screen matches the README example.
  bundleMaxAgeDays: Number(process.env.BUNDLE_MAX_AGE_DAYS || 2),
  // Memory caps for the stand-in: sessions kept, bundles kept (oldest used ones are dropped first).
  maxSessions: Number(process.env.MAX_SESSIONS || 500),
  bundleStoreMax: Number(process.env.BUNDLE_STORE_MAX || 200),
  // Studio LLM proxy limits (calls per session, calls per UTC day for the whole server).
  llmCallsPerSession: num(process.env.LLM_CALLS_PER_SESSION, 150),
  llmCallsPerDay: num(process.env.LLM_CALLS_PER_DAY, 2000),
  // Live Claude protection: model runs (one user action, not one tool turn) per client IP per hour and per host per UTC day.
  // Past a cap, or when the API fails, the action is answered from the recorded run or the rule-based stand-in.
  llmLivePerIpHour: num(process.env.LLM_LIVE_PER_IP_HOUR, 10),
  llmLivePerDay: num(process.env.LLM_LIVE_PER_DAY, 150),
  llmTimeoutMs: num(process.env.LLM_TIMEOUT_MS, 45000),
  // Reverse proxy hops in front of the server (nginx = 1), so the client IP comes from X-Forwarded-For.
  trustProxyHops: num(process.env.TRUST_PROXY_HOPS, 1),
  mockBundleCount: Number(process.env.MOCK_BUNDLE_COUNT || 16),
  // Findings from the sandbox runs (VERIFY.md). Unknown values stay null and are shown as pending.
  v9KeptReceivePlanEmail: parseTri(process.env.V9_KEPT_RECEIVE_PLAN_EMAIL),
  v4PatchSendsEmail: parseTri(process.env.V4_PATCH_SENDS_EMAIL),
  capPct: process.env.INCREASE_CAP_PCT ? Number(process.env.INCREASE_CAP_PCT) : null,
  capDays: Number(process.env.INCREASE_CAP_DAYS || 180),
  schedulerIntervalMs: Number(process.env.SCHEDULER_INTERVAL_MS || 3600000),
}

function parseTri(value) {
  if (value === 'true') return true
  if (value === 'false') return false
  return null
}

export const modes = {
  llm: config.llmBackend === 'account' ? 'account' : config.llmBackend === 'api' ? 'live' : 'mock',
  paypal: config.paypalClientId && config.paypalClientSecret ? 'sandbox' : 'mock',
}
