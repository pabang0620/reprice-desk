import express from 'express'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { config, modes } from './config.js'
import { errorHandler } from './http.js'
import { createApp } from './routes.js'
import * as store from './store.js'

const app = express()
app.use(express.json({ limit: '1mb' }))
store.loadBundles()
const { router, desk } = createApp()
app.use('/api', router)

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist')
if (existsSync(dist)) {
  app.use(express.static(dist))
  app.get('/{*splat}', (req, res) => res.sendFile(path.join(dist, 'index.html')))
}
app.use(errorHandler)

// Scheduled raises run from one daily-style timer. Each raise is guarded by its own key, so a repeat is harmless.
setInterval(() => desk.runScheduler().catch(() => {}), config.schedulerIntervalMs).unref()

app.listen(config.port, () => {
  process.stdout.write(`Reprice Desk on http://localhost:${config.port} (PayPal: ${modes.paypal === 'sandbox' ? 'sandbox' : 'stand-in'}, Claude: ${modes.llm === 'live' ? 'live' : modes.llm === 'account' ? 'local account' : 'stand-in'})\n`)
})
