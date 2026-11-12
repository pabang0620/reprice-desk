import { z } from 'zod'
import { config } from '../config.js'
import { textItem, toolCallItem, toResponse } from './convert.js'

// Local development only (LLM_BACKEND=account). One Studio model turn is answered through the Claude Agent SDK,
// which signs in with the developer's Claude Code account. The Anthropic API key is never used: it is removed
// from the environment handed to the Claude Code process. Tools are exposed as an in-process MCP server whose
// handlers only record the call, so the browser harness (not this server) runs the tool loop, as with the API path.
const SERVER_NAME = 'studio'
const PREFIX = `mcp__${SERVER_NAME}__`
const RESPOND = 'respond'
export const ACCOUNT_LABEL = 'Claude Sonnet (local account)'

let sdk = null
async function loadSdk() {
  if (!sdk) sdk = await import('@anthropic-ai/claude-agent-sdk')
  return sdk
}

// Env for the Claude Code process: no API key or token, so the Claude Code login is used.
export function accountEnv(source = process.env) {
  const { ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, ...rest } = source
  return rest
}

function shapeOf(schema) {
  try {
    const parsed = z.fromJSONSchema(schema)
    return parsed.shape || {}
  } catch {
    return {}
  }
}

const textOf = (content = []) => content.filter((c) => c.type === 'text').map((c) => c.text).join('\n')

// The harness resends the whole transcript every turn, so the turn is stateless: it is written out as text.
export function buildPrompt(request) {
  const lines = []
  for (const item of request.input || []) {
    if (item.type === 'message' && item.kind === 'input') lines.push(`[${item.role === 'system' ? 'system' : 'user'}] ${textOf(item.content)}`)
    else if (item.type === 'message') lines.push(`[assistant] ${textOf(item.content)}`)
    else if (item.type === 'function_call') lines.push(`[assistant called tool ${item.name} with ${item.arguments || '{}'}]`)
    else if (item.type === 'function_call_output') lines.push(`[tool result] ${String(item.output ?? '')}`)
  }
  const structured = request.responseFormat?.type === 'json'
  const choice = request.toolChoice
  const tail = structured
    ? `Take the next step. When you have what you need, you must give your final answer by calling the ${RESPOND} tool.`
    : choice === 'required' || (choice && typeof choice === 'object')
      ? 'Take the next step. You must call one of the tools now.'
      : 'Take the next step: call tools if you need data, otherwise answer the operator.'
  return `${lines.join('\n')}\n\n${tail}`
}

export function toolDefinitions(request) {
  const tools = (request.tools || []).map((t) => ({ name: t.name, description: t.description || t.name, schema: t.parameters || { type: 'object', properties: {} } }))
  if (request.responseFormat?.type === 'json') {
    tools.push({ name: RESPOND, description: request.responseFormat.description || 'Return the final structured answer.', schema: request.responseFormat.schema })
  }
  return tools
}

function bareName(name) {
  return name.startsWith(PREFIX) ? name.slice(PREFIX.length) : name
}

// One model turn. `loader` is injectable so tests can pass a fake SDK.
export async function runAccountTurn(request, { loader = loadSdk, model = config.anthropicModel } = {}) {
  const agentSdk = await loader()
  const calls = []
  const defs = toolDefinitions(request)
  const server = agentSdk.createSdkMcpServer({
    name: SERVER_NAME,
    version: '1.0.0',
    tools: defs.map((def) => agentSdk.tool(def.name, def.description, shapeOf(def.schema), async (input) => {
      calls.push({ name: def.name, input })
      return { content: [{ type: 'text', text: 'Call recorded. Stop and wait for the result.' }] }
    })),
  })
  const texts = []
  let resultText = ''
  const stream = agentSdk.query({
    prompt: buildPrompt(request),
    options: {
      model,
      systemPrompt: request.instructions || 'You are a helpful assistant.',
      tools: [],
      allowedTools: [`${PREFIX}*`],
      mcpServers: { [SERVER_NAME]: server },
      // One model step: the tools only record their call, the harness runs them in the browser.
      maxTurns: 1,
      effort: 'medium',
      settingSources: [],
      persistSession: false,
      env: accountEnv(),
    },
  })
  try {
    for await (const message of stream) {
      if (message.type === 'assistant') {
        const text = textOf(message.message?.content)
        if (text) texts.push(text)
      } else if (message.type === 'result') {
        if (message.subtype === 'success') resultText = message.result || ''
        else if (message.subtype !== 'error_max_turns') throw new Error(`Account model call failed: ${message.subtype}`)
      }
    }
  } catch (err) {
    // The one allowed step is used up after the tool calls were recorded. That is the normal end of a turn.
    if (!/maximum number of turns/i.test(String(err?.message)) || !(calls.length || texts.length)) throw err
  }
  return toTurnResponse({ calls, texts, resultText, structured: request.responseFormat?.type === 'json', model })
}

export function toTurnResponse({ calls, texts, resultText, structured, model }) {
  const output = []
  if (!structured || !calls.some((c) => bareName(c.name) === RESPOND)) {
    const text = texts.join('\n').trim() || (calls.length ? '' : resultText.trim())
    if (text) output.push(textItem(text))
  }
  for (const call of calls) {
    const name = bareName(call.name)
    if (structured && name === RESPOND) output.push(textItem(JSON.stringify(call.input)))
    else output.push(toolCallItem(name, call.input))
  }
  if (!output.length) output.push(textItem('Done.'))
  return toResponse(output, { model: `${model} (account)` })
}
