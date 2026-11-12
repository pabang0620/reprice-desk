// Delete every conversation of a Studio harness. Thread summaries carry `threadId` (not `id`).
export function clearThreads(harness) {
  if (!harness) return Promise.resolve()
  return Promise.all(harness.threads.map((t) => harness.deleteThread(t.threadId).catch(() => {}))).then(() => undefined)
}
