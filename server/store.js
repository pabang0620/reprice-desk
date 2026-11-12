import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { config } from './config.js'
import { daysBetween } from './domain/dates.js'

// In-memory sessions. Bundles can be persisted to BUNDLES_FILE so a restart does not hand out a used bundle again.
const sessions = new Map()
let bundles = []
const LEASE_MINUTES = 30

const RANK = { fresh: 0, leased: 1, used: 2 }

// Merges two copies of the same pool. A bundle never goes backwards: used beats leased beats fresh,
// and between two leases the newer one wins. Bundles only one side knows are kept.
export function mergeBundles(current, incoming) {
  const byId = new Map(current.map((b) => [b.id, b]))
  for (const other of incoming) {
    const mine = byId.get(other.id)
    if (!mine) { byId.set(other.id, other); continue }
    const a = RANK[mine.status] ?? 0
    const b = RANK[other.status] ?? 0
    if (b > a || (b === a && b === 1 && String(other.leasedAt) > String(mine.leasedAt))) byId.set(other.id, other)
  }
  return [...byId.values()]
}

function readFile() {
  if (!config.bundlesFile || !existsSync(config.bundlesFile)) return null
  try {
    const parsed = JSON.parse(readFileSync(config.bundlesFile, 'utf8'))
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

// Bundles seeded by another process (scripts/seedBundles.js) while the server runs are picked up here.
function syncFromFile() {
  const onDisk = readFile()
  if (onDisk) bundles = mergeBundles(bundles, onDisk)
}

export function loadBundles(initial) {
  const onDisk = readFile()
  bundles = onDisk || initial || []
  return bundles
}

export function addBundles(list) {
  syncFromFile()
  bundles = [...bundles, ...list.map((b) => ({ status: 'fresh', leasedBy: null, leasedAt: null, usedAt: null, ...b }))]
  pruneUsed()
  persist()
}

// Memory cap: when the pool is larger than BUNDLE_STORE_MAX, the oldest used bundles are dropped.
function pruneUsed() {
  let extra = bundles.length - config.bundleStoreMax
  if (extra <= 0) return
  const dropIds = new Set(bundles.filter((b) => b.status === 'used').sort((a, b) => String(a.usedAt).localeCompare(String(b.usedAt))).slice(0, extra).map((b) => b.id))
  bundles = bundles.filter((b) => !dropIds.has(b.id))
}

export function totalBundles() {
  return bundles.length
}

// Re-reads the file and merges before writing, so a bundle added by another process is never overwritten.
function persist() {
  if (!config.bundlesFile) return
  syncFromFile()
  mkdirSync(dirname(config.bundlesFile), { recursive: true })
  const tmp = `${config.bundlesFile}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(bundles, null, 2))
  renameSync(tmp, config.bundlesFile)
}

function leaseExpired(bundle, now) {
  return bundle.status === 'leased' && bundle.leasedAt && now - new Date(bundle.leasedAt) > LEASE_MINUTES * 60000
}

export function freshBundlesLeft(now = new Date()) {
  syncFromFile()
  return bundles.filter((b) => isLeasable(b, now)).length
}

function isLeasable(bundle, now) {
  const ageDays = daysBetween(bundle.seededAt, now)
  const free = bundle.status === 'fresh' || leaseExpired(bundle, now)
  return free && ageDays <= config.bundleMaxAgeDays
}

// A used bundle is never leased again. An expired lease goes back into the pool.
export function leaseBundle(sessionId, now = new Date()) {
  syncFromFile()
  const bundle = bundles.find((b) => isLeasable(b, now))
  if (!bundle) return null
  bundle.status = 'leased'
  bundle.leasedBy = sessionId
  bundle.leasedAt = now.toISOString()
  persist()
  return bundle
}

// Marks the bundle used only if this session still holds the lease and nobody used it. An expired lease that
// was handed to another session means the first session can no longer run (HttpError-like status 409).
export function claimBundleForRun(bundleId, sessionId, now = new Date()) {
  syncFromFile()
  const bundle = bundles.find((b) => b.id === bundleId)
  if (!bundle) throw conflict('Bundle not found. Open a new one.')
  if (bundle.status === 'used') throw conflict('This bundle was already used. Open a new one.')
  if (bundle.status !== 'leased' || bundle.leasedBy !== sessionId) throw conflict('Your lease on this bundle ended and it went to someone else. Open a new bundle. Nothing was written.')
  bundle.status = 'used'
  bundle.usedAt = now.toISOString()
  persist()
}

// Keeps the lease alive while the session is working, so a slow judge does not lose a bundle.
export function renewLease(bundleId, sessionId, now = new Date()) {
  const bundle = bundles.find((b) => b.id === bundleId)
  if (bundle && bundle.status === 'leased' && bundle.leasedBy === sessionId) {
    bundle.leasedAt = now.toISOString()
    persist()
  }
}

function conflict(message) {
  const err = new Error(message)
  err.status = 409
  return err
}

export function markBundleUsed(bundleId, now = new Date()) {
  const bundle = bundles.find((b) => b.id === bundleId)
  if (!bundle) throw new Error('Bundle not found.')
  bundle.status = 'used'
  bundle.usedAt = now.toISOString()
  persist()
}

export function getBundle(bundleId) {
  return bundles.find((b) => b.id === bundleId) || null
}

export function bundleCounts() {
  return bundles.reduce((acc, b) => ({ ...acc, [b.status]: (acc[b.status] || 0) + 1 }), { fresh: 0, leased: 0, used: 0 })
}

export function createSession({ bundleId = null } = {}) {
  while (sessions.size >= config.maxSessions) sessions.delete(sessions.keys().next().value)
  const session = {
    id: randomUUID(),
    bundleId,
    createdAt: new Date().toISOString(),
    rule: null,
    ruleDraft: null,
    inputs: { monthlyCents: 1200, annualCents: 12000, minDays: 7, maxDays: 30 },
    strategy: null,
    plans: new Map(),
    executedPlanIds: new Set(),
    jobs: [],
    jobsDone: new Set(),
    events: [],
    webhooks: [],
    execution: null,
  }
  sessions.set(session.id, session)
  return session
}

export function getSession(id) {
  return sessions.get(id) || null
}

export function allSessions() {
  return [...sessions.values()]
}

export function resetForTests() {
  sessions.clear()
  bundles = []
}
