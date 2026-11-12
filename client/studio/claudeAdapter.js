import { api } from '../api.js'
import { deskStore } from '../deskStore.js'

// AG Studio ships no Claude adapter (the official example is OpenAI only), so this one talks to our own server.
// The server holds the Anthropic key and answers one model turn per call; the Studio harness runs the tool loop.
function* eventsFor(response) {
  for (const item of response.output) {
    if (item.type === 'message') {
      const text = item.content.filter((c) => c.type === 'text').map((c) => c.text).join('')
      if (!text) continue
      yield { type: 'TEXT_MESSAGE_START', messageId: item.id, role: 'assistant' }
      yield { type: 'TEXT_MESSAGE_CONTENT', messageId: item.id, delta: text }
      yield { type: 'TEXT_MESSAGE_END', messageId: item.id }
    } else if (item.type === 'function_call') {
      yield { type: 'TOOL_CALL_START', toolCallId: item.callId, toolCallName: item.name, parentMessageId: item.id }
      yield { type: 'TOOL_CALL_ARGS', toolCallId: item.callId, delta: item.arguments }
      yield { type: 'TOOL_CALL_END', toolCallId: item.callId }
    }
  }
}

export const claudeProxyAdapter = {
  executeTurn(request, options = {}) {
    const complete = api
      .post('/api/studio/llm', { sessionId: deskStore.get().sessionId, request: JSON.parse(JSON.stringify(request)) })
      .then((data) => data.response)
    complete.catch(() => {})
    return {
      stream: {
        async *[Symbol.asyncIterator]() {
          const response = await complete
          yield* eventsFor(response)
        },
      },
      complete,
    }
  },
}
