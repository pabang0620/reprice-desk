import { config } from '../config.js'
import { HttpError } from '../http.js'

// The model proxy spends the server's Claude key, so every call needs a live session and counts against two limits.
export function createLlmLimiter({ perSession = config.llmCallsPerSession, perDay = config.llmCallsPerDay, clock = () => new Date() } = {}) {
  const bySession = new Map()
  let day = ''
  let today = 0
  return {
    take(sessionId) {
      const key = clock().toISOString().slice(0, 10)
      if (key !== day) { day = key; today = 0 }
      if (today >= perDay) throw new HttpError(429, 'The daily model limit is reached. Try again tomorrow.')
      const used = bySession.get(sessionId) || 0
      if (used >= perSession) throw new HttpError(429, 'This session used all of its model calls. Open a new bundle to continue.')
      bySession.set(sessionId, used + 1)
      today += 1
    },
  }
}
