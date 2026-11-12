import { useSyncExternalStore } from 'react'
import { api } from './api.js'

// One small external store. Studio widgets render inside AG Studio's own tree, so they read this store directly.
let state = { config: null, sessionId: null, view: null, busy: false, error: '', card: null, pendingStrategy: null, lastRunAt: 0 }
const listeners = new Set()
const SESSION_KEY = 'reprice-desk.session'

function set(patch) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

export const deskStore = {
  get: () => state,
  subscribe: (l) => { listeners.add(l); return () => listeners.delete(l) },
}

export function useDesk() {
  return useSyncExternalStore(deskStore.subscribe, deskStore.get)
}

async function guarded(fn) {
  set({ busy: true, error: '' })
  try {
    return await fn()
  } catch (err) {
    set({ error: err.message })
    return null
  } finally {
    set({ busy: false })
  }
}

export const actions = {
  async loadConfig() {
    set({ config: await api.get('/api/config') })
  },
  // A page reload resumes the same bundle instead of leasing a new one. Pass fresh to lease another.
  async open({ fresh = false } = {}) {
    return guarded(async () => {
      const saved = fresh ? null : sessionStorage.getItem(SESSION_KEY)
      if (saved) {
        try {
          set({ sessionId: saved, card: null, view: await api.get(`/api/session/${saved}`) })
          return
        } catch {
          sessionStorage.removeItem(SESSION_KEY)
        }
      }
      const { sessionId } = await api.post('/api/session')
      sessionStorage.setItem(SESSION_KEY, sessionId)
      set({ sessionId, card: null })
      set({ view: await api.get(`/api/session/${sessionId}`) })
    })
  },
  async refresh() {
    if (!state.sessionId) return
    set({ view: await api.get(`/api/session/${state.sessionId}`) })
  },
  async setRule(rule) {
    return guarded(async () => set({ view: await api.put(`/api/session/${state.sessionId}/rule`, { rule }), card: null }))
  },
  async setInputs(inputs) {
    return guarded(async () => set({ view: await api.put(`/api/session/${state.sessionId}/inputs`, inputs), card: null }))
  },
  async prepare(strategy) {
    return guarded(async () => {
      const data = await api.post(`/api/session/${state.sessionId}/approval`, { strategy })
      set({ card: { ...data, strategy }, pendingStrategy: strategy })
      await actions.refresh()
    })
  },
  async run() {
    if (!state.card) return null
    return guarded(async () => {
      const view = await api.post(`/api/session/${state.sessionId}/run`, { planId: state.card.planId })
      set({ view, lastRunAt: Date.now() })
    })
  },
  async runScheduler() {
    return guarded(async () => {
      const data = await api.post(`/api/session/${state.sessionId}/scheduler/run`)
      set({ view: data.view })
      return data.outcomes
    })
  },
  clearError: () => set({ error: '' }),
}
