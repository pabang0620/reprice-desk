import Anthropic from '@anthropic-ai/sdk'
import { config } from '../config.js'
import { fromAnthropicResponse, toAnthropicRequest } from './convert.js'
import { mockLlmTurn } from './mockLlm.js'
import { runAccountTurn } from './accountLlm.js'

let client = null

function getClient() {
  if (!client) client = new Anthropic({ apiKey: config.anthropicKey })
  return client
}

// One model turn for the Studio harness. The harness runs the tool loop in the browser; this only answers a single turn.
export async function runLlmTurn(request) {
  if (config.llmBackend === 'account') return runAccountTurn(request)
  if (config.llmBackend !== 'api' || !config.anthropicKey) return mockLlmTurn(request)
  const body = toAnthropicRequest(request, { model: config.anthropicModel })
  const message = await getClient().messages.create(body)
  return fromAnthropicResponse(message, { structured: request.responseFormat?.type === 'json' })
}
