// Walks the README "Testing instructions" in a headless browser against a running server and saves a screenshot
// per step. Used to check the judge path on a fresh `.env.example` and to record a real-model run (see
// builtin/recorded-runs/README.md). It never starts a server and never talks to PayPal or Anthropic itself.
//   node scripts/walk.js --url http://localhost:3002 --shots .scratch/walk [--widget] [--strategy B] [--one-bundle]
// --one-bundle stops after step 6 (for a PayPal sandbox server that holds a single fresh bundle).
// Needs Playwright (`npm i -D playwright`). CHROMIUM_PATH can point at an installed Chromium.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : fallback
}
const URL_ = arg('url', 'http://localhost:3002')
const SHOTS = arg('shots', '.scratch/walk')
const STRATEGY = arg('strategy', 'B')
const WITH_WIDGET = process.argv.includes('--widget')
const ONE_BUNDLE = process.argv.includes('--one-bundle')
const MONTHLY = arg('monthly', '12.00')
const ANNUAL = arg('annual', '120.00')
const REPLY_TIMEOUT_MS = Number(arg('reply-timeout', 240000))

const RECOMMEND = 'Founders must not get any email from PayPal. Which strategy do you recommend?'
const WIDGET = 'Show kept members by signup month.'

const { chromium } = await import('playwright')
mkdirSync(SHOTS, { recursive: true })
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) })
const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } })
const log = []
const note = (step, detail) => {
  const line = `${new Date().toISOString().slice(11, 19)} ${step}: ${detail}`
  log.push(line)
  process.stdout.write(`${line}\n`)
}
const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) })

// The reply is finished when no model turn or agent tool call has been in flight for QUIET_MS. The Studio status
// bar is not used: it can hide between two model turns of one reply.
const QUIET_MS = 6000
let inFlight = 0
let lastActivity = 0
const watched = (req) => /\/api\/studio\/llm|\/agent\//.test(req.url())
page.on('request', (req) => { if (watched(req)) { inFlight += 1; lastActivity = Date.now() } })
const settle = (req) => { if (watched(req)) { inFlight -= 1; lastActivity = Date.now() } }
page.on('requestfinished', settle)
page.on('requestfailed', settle)

async function waitForReply() {
  const started = Date.now()
  const deadline = started + REPLY_TIMEOUT_MS
  while (Date.now() < deadline) {
    await page.waitForTimeout(250)
    if (inFlight === 0 && lastActivity >= started - 1000 && Date.now() - lastActivity >= QUIET_MS) return
  }
  throw new Error('The assistant did not finish in time.')
}

async function ask(text) {
  const box = page.locator('textarea.ag-studio-ai-assistant-textarea')
  await box.fill(text)
  await page.locator('.ag-studio-ai-assistant-send-button').click()
  const started = Date.now()
  await waitForReply()
  return Date.now() - started
}

async function lastAnswer() {
  return page.evaluate(() => {
    const root = document.querySelector('.ag-studio-ai-assistant, [class*="ai-thread"], [class*="ai-messages"]') || document.body
    return root.innerText.split('\n').filter(Boolean).slice(-6).join(' | ').slice(0, 400)
  })
}

// The operator types both prices in the approval card; nothing is prefilled.
async function typePrices() {
  await page.getByLabel(/New monthly/).fill(MONTHLY)
  await page.getByLabel(/New monthly/).press('Enter')
  await page.waitForTimeout(800)
  await page.getByLabel(/New annual/).fill(ANNUAL)
  await page.getByLabel(/New annual/).press('Enter')
  await page.waitForTimeout(1500)
}

// The Execution view's first widget: source line, kept proof, read-back chips, new plan ids, scheduled raises.
const nextStepsText = async () => (await page.getByText('What to do next').locator('..').innerText().catch(() => '(none)')).replace(/\n+/g, ' | ')

const source = async () => ('answer: ' + await page.locator('[data-testid="answer-source"]').textContent().catch(() => '')) || '(none)'

try {
  await page.goto(URL_)
  await page.getByText('Open my bundle').waitFor()
  note('start', (await page.locator('.rd-start-card').innerText()).replace(/\n+/g, ' | '))
  await shot('00_start')

  await page.getByText('Open my bundle').click()
  await page.locator('.ag-studio-ai-prompt-starter').first().waitFor({ timeout: 30000 })
  note('1 open', (await page.locator('.rd-header').innerText()).replace(/\n+/g, ' | '))
  await shot('01_opened')

  let t = Date.now()
  await page.getByRole('button', { name: 'Keep founders' }).click()
  await waitForReply()
  note('2 keep founders', `${Date.now() - t} ms, ${await source()} :: ${await lastAnswer()}`)
  await shot('02_keep_founders')

  note('2 tag', `${await ask('tag')} ms, ${await source()} :: ${await lastAnswer()}`)
  await shot('02_tag')

  await page.getByRole('button', { name: 'Use this rule' }).click()
  await page.waitForTimeout(1500)
  note('3 use this rule', 'clicked')
  await shot('03_rule')
  await typePrices()
  note('3 prices', `typed ${MONTHLY} / ${ANNUAL}`)
  await shot('03b_prices')

  note('4 recommend', `${await ask(RECOMMEND)} ms, ${await source()} :: ${await lastAnswer()}`)
  await shot('04_recommend')

  if (WITH_WIDGET) {
    note('widget', `${await ask(WIDGET)} ms, ${await source()} :: ${await lastAnswer()}`)
    await page.waitForTimeout(3000)
    await shot('04b_widget')
  }

  await page.getByRole('button', { name: `Choose ${STRATEGY}` }).click()
  await page.waitForTimeout(1500)
  note(`5 choose ${STRATEGY}`, (await page.locator('.rd-card, [class*="approval"]').first().innerText().catch(() => '')).replace(/\n+/g, ' | ').slice(0, 400))
  await shot('05_choose')

  await page.getByRole('button', { name: 'Approve & run' }).click()
  await page.getByRole('button', { name: 'Open a new bundle' }).waitFor({ timeout: 60000 })
  await page.waitForTimeout(2000)
  const approveLeft = await page.getByRole('button', { name: 'Approve & run' }).count()
  note('6 approve & run', `Approve buttons still on screen: ${approveLeft}. ${(await page.locator('.rd-header').innerText()).replace(/\n+/g, ' | ')}`)
  await shot('06_execution')
  note('6 next steps', await nextStepsText())
  if (ONE_BUNDLE) {
    note('done', 'walk finished after step 6 (--one-bundle)')
    throw Object.assign(new Error('stop'), { stop: true })
  }

  // Step 7: another bundle, strategy A. The rule chip in Strategy compare stands in for the chat this time.
  await page.getByRole('button', { name: 'Open a new bundle' }).click()
  await page.getByRole('button', { name: /Tagged "founder"/ }).click({ timeout: 30000 })
  await page.waitForTimeout(1500)
  await typePrices()
  await page.getByRole('button', { name: 'Choose A' }).click()
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Approve & run' }).click()
  await page.getByRole('button', { name: 'Open a new bundle' }).waitFor({ timeout: 60000 })
  await page.waitForTimeout(2500)
  const cohorts = await page.evaluate(() => [...document.querySelectorAll('.ag-row')].map((r) => r.innerText.replace(/\s+/g, ' ')).filter((t) => /^[FRA]\d /.test(t)).map((t) => `${t.split(' ')[0]}=${/Kept/.test(t) ? 'Kept' : /Raised/.test(t) ? 'Raised' : '?'}`).join(' '))
  note('7 choose A on a new bundle', `Members: ${cohorts}`)
  note('7 next steps', await nextStepsText())
  await shot('07_execution_a')
  note('done', 'walk finished')
} catch (err) {
  if (!err.stop) {
    note('FAILED', err.message.split('\n')[0])
    await shot('99_failed').catch(() => {})
    process.exitCode = 1
  }
} finally {
  writeFileSync(path.join(SHOTS, 'walk.log'), `${log.join('\n')}\n`)
  await browser.close()
}
