import Anthropic from '@anthropic-ai/sdk'
import { config } from '../config.js'
import { fromAnthropicResponse, requiredTool, requirementText, satisfiesRequirement, textItem, toAnthropicRequest, toResponse } from './convert.js'
import { mockLlmTurn } from './mockLlm.js'
import { ACCOUNT_LABEL, runAccountTurn } from './accountLlm.js'
import { loadRecordings, recordTurn, replayTurn, turnKey } from './recording.js'
import { REASON_UNAVAILABLE } from './limits.js'

let client = null
let recordings = null

function getClient() {
  if (!client) client = new Anthropic({ apiKey: config.anthropicKey })
  return client
}

export function recordedRuns() {
  if (!recordings) recordings = loadRecordings()
  return recordings
}

export const STAND_IN_LABEL = 'Scripted stand-in (no model)'

export async function liveTurn(request, { client = null } = {}) {
  if (config.llmBackend === 'account') return { response: await runAccountTurn(request), source: 'account', label: ACCOUNT_LABEL }
  const need = requiredTool(request)
  const create = (body) => (client || getClient()).messages.create(body, { timeout: config.llmTimeoutMs, maxRetries: 0 })
  const body = toAnthropicRequest(request, { model: config.anthropicModel })
  let message = await create(body)
  if (!satisfiesRequirement(message, need)) {
    // One retry with the instruction repeated in the system prompt, then the existing fallback.
    const again = { ...body, system: `${body.system}\n\n${requirementText(need)}` }
    message = await create(again)
    if (!satisfiesRequirement(message, need)) throw new Error('model did not call the required tool')
  }
  return { response: fromAnthropicResponse(message, { structured: request.responseFormat?.type === 'json' }), source: 'live', label: 'Claude Sonnet (server API key)' }
}

function withTimeout(promise, ms) {
  let timer
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('model timeout')), ms) })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

// Only the first turn of the primary agent for a new user message starts a run. Delegate agents (data, page, widget)
// and later tool turns belong to the run in progress.
export function runInfo(request) {
  const key = turnKey(request)
  const primary = (request.tools || []).some((t) => t.name === 'scan_subscribers')
  return { runKey: `${key.userTurns}:${key.userText}`, runStart: primary && key.step === 0 }
}

// The stand-in reads tool results written for it; an unexpected shape must still end in a plain sentence.
function safeStandIn(request) {
  try {
    return mockLlmTurn(request)
  } catch {
    return toResponse([textItem('The live model is not available right now. Use the desk on the left: pick who to keep, type the new prices and approve.')])
  }
}

// The judge never sees a raw error: a recorded real turn when one matches, else the rule-based stand-in.
export function fallbackTurn(request, runs, reason) {
  const replay = replayTurn(request, runs)
  if (replay) return { ...replay, label: `${replay.label} (${reason})`, source: 'recorded', fallback: reason }
  return { response: safeStandIn(request), source: 'stand-in', label: `Rule-based stand-in (${reason})`, fallback: reason }
}

// One model turn for the Studio harness. The harness runs the tool loop in the browser; this only answers a single turn.
// Stand-in mode first replays a recorded real-model turn when the conversation matches one, else uses the script.
// With a live backend the guard counts runs per IP per hour and per day; past a cap, or when the API fails, the
// same recorded-or-stand-in answer is used. `source` and `label` say honestly where the answer came from.
export async function runLlmTurn(request, {
  runs = recordedRuns(),
  recordFile = config.llmRecordFile,
  backend = config.llmBackend,
  live = liveTurn,
  guard = null,
  ip = 'unknown',
  sessionId = '',
  timeoutMs = config.llmTimeoutMs,
  onFailure = (err) => process.stderr.write(`live model failed, using fallback: ${err?.status || ''} ${err?.name || 'Error'}\n`),
} = {}) {
  if (backend === 'mock') {
    const replay = replayTurn(request, runs)
    if (replay) return { ...replay, source: 'recorded' }
    return { response: mockLlmTurn(request), source: 'stand-in', label: STAND_IN_LABEL }
  }
  const gate = guard ? guard.admit({ ip, sessionId, ...runInfo(request) }) : { live: true }
  if (!gate.live) return fallbackTurn(request, runs, gate.reason)
  const started = Date.now()
  try {
    const result = await withTimeout(live(request), timeoutMs)
    if (recordFile) recordTurn(recordFile, request, result.response, { ms: Date.now() - started, model: config.anthropicModel })
    return result
  } catch (err) {
    onFailure(err)
    guard?.fail(sessionId, REASON_UNAVAILABLE)
    return fallbackTurn(request, runs, REASON_UNAVAILABLE)
  }
}
