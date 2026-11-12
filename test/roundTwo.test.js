import test from 'node:test'
import assert from 'node:assert/strict'
import { clearThreads } from '../client/studio/threads.js'
import { executionState } from '../client/studio/views.js'

test('clearThreads deletes every thread by its threadId (a new bundle starts a clean chat)', async () => {
  const deleted = []
  const harness = {
    threads: [{ threadId: 'a' }, { threadId: 'b' }],
    deleteThread: async (id) => { deleted.push(id) },
  }
  await clearThreads(harness)
  assert.deepEqual(deleted, ['a', 'b'])
  await clearThreads(null)
})

test('execution layout keeps every widget inside the 24-column grid without overlap', () => {
  const page = executionState().pages[0]
  const cells = Object.values(page.widgetLayout)
  for (const c of cells) assert.ok(c.xTrack + c.xSpan <= 24)
  for (let i = 0; i < cells.length; i += 1) {
    for (let j = i + 1; j < cells.length; j += 1) {
      const a = cells[i]
      const b = cells[j]
      const overlap = a.xTrack < b.xTrack + b.xSpan && b.xTrack < a.xTrack + a.xSpan && a.yTrack < b.yTrack + b.ySpan && b.yTrack < a.yTrack + a.ySpan
      assert.equal(overlap, false)
    }
  }
})
