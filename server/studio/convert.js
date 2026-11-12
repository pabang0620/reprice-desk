// Converts between AG Studio's LLM adapter shapes (AgLlmRequest / AgLlmResponse) and the Anthropic Messages API.
// Pure functions, so they are tested without any network call.

function textOfInput(content = []) {
  return content.filter((c) => c.type === 'text').map((c) => c.text).join('\n')
}

function parseArgs(text) {
  try {
    const value = JSON.parse(text || '{}')
    return value && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}

function pushMessage(messages, role, blocks) {
  const last = messages[messages.length - 1]
  if (last && last.role === role) last.content.push(...blocks)
  else messages.push({ role, content: [...blocks] })
}

// Which tool the turn must call: a name, 'any', or null. Never expressed as tool_choice.
export function requiredTool(request) {
  if (request.responseFormat?.type === 'json') return 'respond'
  const choice = request.toolChoice
  if (!(request.tools || []).length) return null
  if (choice === 'required') return 'any'
  if (choice && typeof choice === 'object' && choice.name) return choice.name
  return null
}

export function requirementText(need) {
  return need === 'any' ? 'You must call one of the tools in this turn.' : `You must answer by calling the tool ${need}.`
}

// True when the model message satisfies the requirement (always true when nothing is required).
export function satisfiesRequirement(message, need) {
  if (!need) return true
  const uses = (message.content || []).filter((b) => b.type === 'tool_use')
  return need === 'any' ? uses.length > 0 : uses.some((b) => b.name === need)
}

export function toAnthropicRequest(request, { model, maxTokens = 4096 } = {}) {
  const system = []
  if (request.instructions) system.push(request.instructions)
  const messages = []
  for (const item of request.input || []) {
    if (item.type === 'message' && item.kind === 'input') {
      const text = textOfInput(item.content)
      if (item.role === 'system') system.push(text)
      else pushMessage(messages, 'user', [{ type: 'text', text }])
    } else if (item.type === 'message') {
      const text = (item.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n')
      if (text) pushMessage(messages, 'assistant', [{ type: 'text', text }])
    } else if (item.type === 'function_call') {
      pushMessage(messages, 'assistant', [{ type: 'tool_use', id: item.callId, name: item.name, input: parseArgs(item.arguments) }])
    } else if (item.type === 'function_call_output') {
      pushMessage(messages, 'user', [{ type: 'tool_result', tool_use_id: item.callId, content: String(item.output ?? '') }])
    }
  }
  // Anthropic wants tool_result blocks first inside a user turn.
  for (const m of messages) {
    if (m.role === 'user') m.content.sort((a, b) => (a.type === 'tool_result' ? -1 : 0) - (b.type === 'tool_result' ? -1 : 0))
  }
  const tools = (request.tools || []).map((t) => ({
    name: t.name,
    description: t.description || t.name,
    input_schema: t.parameters && t.parameters.type === 'object' ? t.parameters : { type: 'object', properties: {} },
  }))
  const need = requiredTool(request)
  const instruction = need ? requirementText(need) : request.toolChoice === 'none' ? 'Do not call any tool in this turn. Answer in plain text.' : ''
  if (instruction) system.push(instruction)
  const body = { model, max_tokens: maxTokens, system: system.join('\n\n'), messages }
  // This model rejects forced tool choice (HTTP 400), so tool_choice is never sent. The instruction above plus a
  // check after the response (see satisfiesRequirement) replace it.
  if (request.responseFormat?.type === 'json') {
    body.tools = [...tools, { name: 'respond', description: request.responseFormat.description || 'Return the final structured answer.', input_schema: request.responseFormat.schema }]
  } else if (tools.length) {
    body.tools = tools
  }
  return body
}

let counter = 0
const nextId = (prefix) => `${prefix}_${Date.now().toString(36)}_${(counter += 1)}`

export function textItem(text) {
  return { id: nextId('msg'), kind: 'output', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'text', text, annotations: [] }] }
}

export function toolCallItem(name, args) {
  const callId = nextId('call')
  return { id: nextId('fc'), kind: 'output', type: 'function_call', callId, name, arguments: JSON.stringify(args ?? {}), status: 'completed' }
}

export function toResponse(output, { model = 'mock', usage } = {}) {
  return { id: nextId('resp'), createdAt: Date.now(), output, status: 'completed', model, ...(usage ? { usage } : {}) }
}

export function fromAnthropicResponse(message, { structured = false } = {}) {
  const output = []
  for (const block of message.content || []) {
    if (block.type === 'text' && block.text) output.push(textItem(block.text))
    else if (block.type === 'tool_use') {
      if (structured && block.name === 'respond') output.push(textItem(JSON.stringify(block.input)))
      else output.push(toolCallItem(block.name, block.input))
    }
  }
  if (!output.length) output.push(textItem(message.stop_reason === 'refusal' ? 'I cannot help with that request.' : 'Done.'))
  return toResponse(output, { model: message.model })
}
