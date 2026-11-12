import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { textItem, toolCallItem, toResponse } from './convert.js'

// Recorded real-model runs. In account mode a turn can be written to a transcript file (LLM_RECORD_FILE).
// In stand-in mode a turn whose conversation matches a recorded turn is answered with what the real model said,
// and the screen labels it "Recorded run". A turn that does not match falls back to the scripted stand-in.

export const RECORDED_RUNS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../builtin/recorded-runs')

const textOf = (content = []) => content.filter((c) => c.type === 'text').map((c) => c.text).join(' ')
const isUser = (item) => item.type === 'message' && item.kind === 'input' && item.role === 'user'

export function normalizeText(text) {
  return String(text || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.!?]+$/, '')
}

// Volatile parts of a tool result (dates, ids, timestamps) are blanked, so the same bundle state on another day
// gives the same fingerprint, but a different state (an error, other members, other counts) does not.
export function normalizeOutput(text) {
  return String(text ?? '')
    .replace(/\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?/g, 'D')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, 'U')
    .replace(/\b(I|P|B-PROD|PROD)-[A-Z0-9]+\b/g, 'ID')
    .replace(/\b(msg|call|fc|resp)_[a-z0-9_]+/gi, 'ID')
    .replace(/\d{10,}/g, 'N')
}

const hash = (value) => createHash('sha1').update(value).digest('hex').slice(0, 16)

// Which agent asked: the start of its instructions plus the tool names it was given.
export function agentSignature(request) {
  const tools = (request.tools || []).map((t) => t.name).sort().join(',')
  return hash(`${String(request.instructions || '').slice(0, 160)}|${tools}`)
}

// Studio layout tools report live widget and page state that changes with render timing, so their results are
// not compared. Every other tool result (our desk tools, data queries, delegate summaries) must match exactly.
export const VOLATILE_TOOLS = new Set(['view_widget', 'view_page', 'add_widget', 'configure_widget', 'add_widget_filter'])

export function turnKey(request) {
  const input = request.input || []
  let last = -1
  let userTurns = 0
  input.forEach((item, i) => { if (isUser(item)) { last = i; userTurns += 1 } })
  const after = input.slice(last + 1)
  const userText = last >= 0 ? normalizeText(textOf(input[last].content)) : ''
  const names = new Map(input.filter((i) => i.type === 'function_call').map((i) => [i.callId, i.name]))
  const outputs = after.filter((i) => i.type === 'function_call_output')
    .map((i) => ({ name: names.get(i.callId) || '', hash: hash(`${i.status || ''}:${normalizeOutput(i.output)}`) }))
  return {
    agent: agentSignature(request),
    userText,
    userTurns,
    step: after.length,
    outputs,
    structured: request.responseFormat?.type === 'json',
  }
}

const stable = (outputs = []) => outputs.filter((o) => !VOLATILE_TOOLS.has(o.name)).map((o) => `${o.name}:${o.hash}`).join('|')

// The number of earlier questions is not compared: a judge may skip a question, and every tool result the
// recorded answer relies on is still checked.
export const sameKey = (a, b) => a.agent === b.agent && a.userText === b.userText
  && a.step === b.step && a.structured === b.structured && stable(a.outputs) === stable(b.outputs)

const lastTurnAt = (run) => run.turns.reduce((latest, t) => (String(t.at) > latest ? String(t.at) : latest), '')

// Newest recording first: when an older run also matches a turn, the latest real-model answer is the one replayed.
export function loadRecordings(dir = RECORDED_RUNS_DIR) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => {
    const run = JSON.parse(readFileSync(path.join(dir, f), 'utf8'))
    return { ...run, file: f }
  }).sort((a, b) => lastTurnAt(b).localeCompare(lastTurnAt(a)))
}

// Fresh ids each time, so a replay never reuses another conversation's call ids.
function cloneOutput(output) {
  return output.map((item) => {
    if (item.type === 'function_call') {
      let args = {}
      try { args = JSON.parse(item.arguments || '{}') } catch { args = {} }
      return toolCallItem(item.name, args)
    }
    return textItem(textOf(item.content))
  })
}

export function recordedLabel(run) {
  return `Recorded run: ${run.modelLabel || 'Claude Sonnet'}, ${run.recordedOn}`
}

export function replayTurn(request, runs) {
  const key = turnKey(request)
  for (const run of runs) {
    const turn = run.turns.find((t) => sameKey(t.key, key))
    if (turn) return { response: toResponse(cloneOutput(turn.output), { model: `${run.model} (recorded ${run.recordedOn})` }), label: recordedLabel(run) }
  }
  return null
}

function summarize(output) {
  return {
    text: output.filter((i) => i.type === 'message').map((i) => textOf(i.content)).join('\n'),
    toolCalls: output.filter((i) => i.type === 'function_call').map((i) => ({ name: i.name, arguments: i.arguments })),
  }
}

// Append one real turn to a transcript file. Only the key, the model output and timings are kept.
export function recordTurn(file, request, response, { ms, model, now = new Date() }) {
  const run = existsSync(file)
    ? JSON.parse(readFileSync(file, 'utf8'))
    : { model, modelLabel: 'Claude Sonnet', backend: 'account (local Claude Code login, no API key)', recordedOn: now.toISOString().slice(0, 10), turns: [] }
  const turn = {
    seq: run.turns.length + 1,
    at: now.toISOString(),
    ms,
    agentInstructions: String(request.instructions || '').slice(0, 80),
    key: turnKey(request),
    ...summarize(response.output),
    output: response.output,
  }
  writeFileSync(file, `${JSON.stringify({ ...run, turns: [...run.turns, turn] }, null, 2)}\n`)
  return turn
}
