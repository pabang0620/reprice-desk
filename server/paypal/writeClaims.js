// Claim store for PayPal writes. A claim is written BEFORE the SDK call, under a key every caller of the same
// write computes the same (target id plus target value). The second claimant is stopped before it reaches PayPal.
// States: pending (call in flight), done (result recorded), unknown (PayPal may have acted, not confirmed yet).
// In memory: it lives as long as the server process. The bundle "used" mark in the bundle store is the restart-safe guard.
export class WriteClaims {
  #entries = new Map()

  // Returns { won: true } for the first claimant. Everyone else gets the existing entry.
  begin(key) {
    const existing = this.#entries.get(key)
    if (existing) return { won: false, entry: existing }
    const entry = { key, state: 'pending', result: undefined }
    entry.settled = new Promise((resolve, reject) => {
      entry.resolve = resolve
      entry.reject = reject
    })
    // The winner reports its own outcome; a waiting loser may never exist, so a rejection here is not unhandled.
    entry.settled.catch(() => {})
    this.#entries.set(key, entry)
    return { won: true, entry }
  }

  has(key) {
    return this.#entries.has(key)
  }

  stateOf(key) {
    return this.#entries.get(key)?.state || null
  }

  done(key, result) {
    const entry = this.#entries.get(key)
    if (!entry) return
    entry.state = 'done'
    entry.result = result
    entry.resolve(result)
  }

  // Keeps the claim so nobody repeats a write PayPal may already have applied.
  markUnknown(key, error) {
    const entry = this.#entries.get(key)
    if (!entry) return
    entry.state = 'unknown'
    entry.reject(error)
  }

  // Used when PayPal refused the call or it never left: a later attempt must not be blocked.
  release(key, error) {
    const entry = this.#entries.get(key)
    if (!entry) return
    this.#entries.delete(key)
    entry.reject(error)
  }

  // A settled unknown claim becomes done again.
  settle(key, result) {
    const entry = this.#entries.get(key)
    if (!entry) return
    entry.state = 'done'
    entry.result = result
  }
}
