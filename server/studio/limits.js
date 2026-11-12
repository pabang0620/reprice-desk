import { config } from '../config.js'

export const REASON_LIMIT = 'live limit reached'
export const REASON_UNAVAILABLE = 'live model unavailable'

const HOUR_MS = 3600 * 1000
const MAX_TRACKED = 5000

// The model proxy spends the server's Claude key. This guard never refuses a request: when a limit is reached it says
// "not live" with a short reason, and the caller answers from the recorded run or the stand-in instead.
//
// Limits, all counted only for calls that would reach the live model:
// - runs per client IP per hour and runs per host per UTC day. A run is one user action (the first turn of the
//   primary agent for a new user message); later tool turns and delegate turns of the same run are free.
// - model turns per session and per day (older safety net, kept).
export function createLlmLimiter({
  perIpHour = config.llmLivePerIpHour,
  perDay = config.llmLivePerDay,
  turnsPerSession = config.llmCallsPerSession,
  turnsPerDay = config.llmCallsPerDay,
  clock = () => new Date(),
} = {}) {
  const ipHits = new Map()
  const sessions = new Map()
  let day = ''
  let runsToday = 0
  let turnsToday = 0

  const rollDay = () => {
    const key = clock().toISOString().slice(0, 10)
    if (key !== day) { day = key; runsToday = 0; turnsToday = 0 }
  }

  const recentHits = (ip, now) => {
    const hits = (ipHits.get(ip) || []).filter((t) => now - t < HOUR_MS)
    if (hits.length) ipHits.set(ip, hits)
    else ipHits.delete(ip)
    return hits
  }

  const remember = (sessionId, entry) => {
    sessions.delete(sessionId)
    sessions.set(sessionId, entry)
    if (sessions.size > MAX_TRACKED) sessions.delete(sessions.keys().next().value)
  }

  return {
    // runKey identifies the user action; runStart says this request may begin a new run.
    admit({ ip = 'unknown', sessionId, runKey = '', runStart = true }) {
      rollDay()
      const now = clock().getTime()
      let entry = sessions.get(sessionId) || { runKey: null, reason: null, turns: 0 }
      if ((runStart || entry.runKey === null) && entry.runKey !== runKey) {
        const hits = recentHits(ip, now)
        if (runsToday >= perDay || hits.length >= perIpHour) {
          entry = { ...entry, runKey, reason: REASON_LIMIT }
        } else {
          runsToday += 1
          ipHits.set(ip, [...hits, now])
          if (ipHits.size > MAX_TRACKED) ipHits.delete(ipHits.keys().next().value)
          entry = { ...entry, runKey, reason: null }
        }
      }
      if (!entry.reason) {
        if (turnsToday >= turnsPerDay || entry.turns >= turnsPerSession) entry = { ...entry, reason: REASON_LIMIT }
        else { turnsToday += 1; entry = { ...entry, turns: entry.turns + 1 } }
      }
      remember(sessionId, entry)
      return entry.reason ? { live: false, reason: entry.reason } : { live: true, reason: null }
    },
    // After an API failure the rest of the run stays on the fallback, so one answer never mixes two sources.
    fail(sessionId, reason = REASON_UNAVAILABLE) {
      const entry = sessions.get(sessionId)
      if (entry) remember(sessionId, { ...entry, reason })
    },
  }
}
