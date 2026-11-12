import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SANDBOX_EVIDENCE } from '../server/evidence.js'

// The docs repeat VERIFY results in several places (VERIFY rows, the Hosting section, the README and DEVPOST
// "not run" lists, the in-app evidence panel). These tests tie them together, so a status changed in one place
// fails here instead of leaving an old line elsewhere (REVIEW_4 defects 4 and 6).

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const HOST = 'https://reprice-desk.35-216-2-121.sslip.io'

// "| V3 | ..." and "| V1 (a) | ..." rows: id -> status after "RESULT <date>:".
function verifyStatus() {
  const rows = new Map()
  for (const line of read('VERIFY.md').split('\n')) {
    const m = line.match(/^\| (V\d+(?: \([a-c]\))?) \|.*\*\*RESULT \d{4}-\d{2}-\d{2}: ([A-Z]+(?: [A-Z]+)*)(?![a-z])/)
    if (m) rows.set(m[1], m[2])
  }
  return rows
}

const idsIn = (text) => [...text.matchAll(/\bV(\d+)(?: \(?([a-c])\)?)?/g)].map((m) => (m[2] ? `V${m[1]} (${m[2]})` : `V${m[1]}`))
const isPass = (status) => /^(PARTIAL )?PASS$/.test(status)

test('every VERIFY row has a status line', () => {
  const rows = verifyStatus()
  for (const id of ['V1 (a)', 'V1 (b)', 'V1 (c)', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8', 'V9', 'V10', 'V11', 'V12', 'V13', 'V14', 'V15', 'V16', 'V17', 'V18', 'V19', 'V20']) {
    assert.ok(rows.has(id), `VERIFY row ${id} has no "RESULT <date>: STATUS" line`)
  }
})

test('the Hosting section, the V16 row and the README / DEVPOST "Try it" link agree', () => {
  const verify = read('VERIFY.md')
  const hosting = verify.slice(verify.indexOf('## Hosting')).match(/\*\*Result: ([A-Z]+)/)?.[1]
  assert.ok(hosting, 'VERIFY has a Hosting result line')
  const v16 = verifyStatus().get('V16')
  assert.equal(v16, hosting, `V16 row says ${v16} but the Hosting section says ${hosting}`)
  for (const file of ['README.md', 'DEVPOST.md']) {
    const linked = read(file).includes(`**Try it:** ${HOST}`)
    assert.equal(linked, hosting === 'PASS', `${file} "Try it" link must be there exactly when hosting passed`)
  }
})

test('items the docs list as not run are not PASS in VERIFY, and hosting is not listed as not run once it passed', () => {
  const rows = verifyStatus()
  const lists = [
    ['README.md', read('README.md').split('\n').find((l) => l.startsWith('Not run yet, so not claimed:'))],
    ['DEVPOST.md', read('DEVPOST.md').split('\n').find((l) => l.includes('**Not proven yet:**'))],
    ['server/evidence.js', SANDBOX_EVIDENCE.notClaimed],
  ]
  for (const [file, line] of lists) {
    assert.ok(line, `${file} has a not-run list`)
    for (const id of idsIn(line)) {
      assert.ok(rows.has(id), `${file} names ${id}, which VERIFY does not have`)
      assert.ok(!isPass(rows.get(id)), `${file} lists ${id} as not run, but VERIFY says ${rows.get(id)}`)
    }
  }
})

test('the in-app evidence panel claims only what VERIFY records', () => {
  const rows = verifyStatus()
  for (const e of [...SANDBOX_EVIDENCE.sandbox, ...SANDBOX_EVIDENCE.model]) {
    const status = rows.get(e.id)
    assert.ok(status, `evidence ${e.id} has no VERIFY row`)
    if (e.result === 'FINDING') assert.ok(!isPass(status), `${e.id} is a finding, VERIFY says ${status}`)
    else assert.ok(isPass(status), `evidence panel says ${e.result} for ${e.id}, VERIFY says ${status}`)
  }
})

test('the V3 day range in the evidence panel matches the days VERIFY measured', () => {
  const v3 = read('VERIFY.md').split('\n').find((l) => l.startsWith('| V3 |'))
  const days = v3.match(/next charge in ([\d, ]+) days/)[1].split(',').map((d) => Number(d.trim()))
  const text = SANDBOX_EVIDENCE.sandbox.find((e) => e.id === 'V3').text
  const [, from, to] = text.match(/(\d+) to (\d+) days ahead/)
  assert.deepEqual([Number(from), Number(to)], [Math.min(...days), Math.max(...days)])
})
