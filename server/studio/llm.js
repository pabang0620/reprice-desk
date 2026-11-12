import Anthropic from '@anthropic-ai/sdk'
import { config } from '../config.js'
import { fromAnthropicResponse, toAnthropicRequest } from './convert.js'
import { mockLlmTurn } from './mockLlm.js'
import { ACCOUNT_LABEL, runAccountTurn } from './accountLlm.js'
import { loadRecordings, recordTurn, replayTurn } from './recording.js'

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

async function liveTurn(request) {
  if (config.llmBackend === 'account') return { response: await runAccountTurn(request), source: 'account', label: ACCOUNT_LABEL }
  const body = toAnthropicRequest(request, { model: config.anthropicModel })
  const message = await getClient().messages.create(body)
  return { response: fromAnthropicResponse(message, { structured: request.responseFormat?.type === 'json' }), source: 'live', label: 'Claude Sonnet (server API key)' }
}

// One model turn for the Studio harness. The harness runs the tool loop in the browser; this only answers a single turn.
// Stand-in mode first replays a recorded real-model turn when the conversation matches one, else uses the script.
// `source` and `label` say honestly where the answer came from.
export async function runLlmTurn(request, { runs = recordedRuns(), recordFile = config.llmRecordFile } = {}) {
  if (config.llmBackend === 'mock') {
    const replay = replayTurn(request, runs)
    if (replay) return { ...replay, source: 'recorded' }
    return { response: mockLlmTurn(request), source: 'stand-in', label: STAND_IN_LABEL }
  }
  const started = Date.now()
  const result = await liveTurn(request)
  if (recordFile) recordTurn(recordFile, request, result.response, { ms: Date.now() - started, model: config.anthropicModel })
  return result
}
