import { textItem, toResponse, toolCallItem } from './convert.js'

// Scripted stand-in for Claude. It follows the same tool protocol, so the whole desk runs without a key.
// It only reads tool outputs (computed by code) and phrases them. It never invents a number.

function lastUserText(input) {
  for (let i = input.length - 1; i >= 0; i -= 1) {
    const item = input[i]
    if (item.type === 'message' && item.kind === 'input' && item.role === 'user') {
      return item.content.filter((c) => c.type === 'text').map((c) => c.text).join(' ')
    }
  }
  return ''
}

function turnItems(input) {
  let start = 0
  input.forEach((item, i) => { if (item.type === 'message' && item.kind === 'input' && item.role === 'user') start = i })
  return input.slice(start + 1)
}

function outputOf(items, toolName) {
  const call = items.find((i) => i.type === 'function_call' && i.name === toolName)
  if (!call) return { called: false }
  const out = items.find((i) => i.type === 'function_call_output' && i.callId === call.callId)
  if (!out) return { called: true, pending: true }
  return { called: true, value: unwrap(out.output) }
}

// The harness may wrap a tool result as { success, response, data }. Accept the bare data or the wrapped form.
function unwrap(output) {
  let parsed
  try { parsed = JSON.parse(output) } catch { return { raw: output } }
  if (parsed && typeof parsed === 'object' && parsed.success === true) {
    if (parsed.data !== undefined) return parsed.data
    if (typeof parsed.response === 'string') { try { return JSON.parse(parsed.response) } catch { return { raw: parsed.response } } }
  }
  return parsed
}

function delegateArgs(tool, task) {
  const props = tool?.parameters?.properties || {}
  const args = {}
  for (const [key, spec] of Object.entries(props)) {
    if (spec.enum) args[key] = spec.enum.includes('widget') ? 'widget' : spec.enum[0]
    else if (spec.type === 'array') args[key] = ['widget']
    else if (spec.type === 'string') args[key] = key.toLowerCase().includes('target') || key.toLowerCase().includes('agent') ? 'widget' : task
  }
  return args
}

const ruleWords = { tag: /\btag/i, signup: /sign ?up|month|date/i, source: /launch|source|referral|channel/i }

// The stand-in cannot run the built-in widget agent. Say what really happened.
function delegateSucceeded(output) {
  if (output.status && output.status !== 'completed') return false
  const value = unwrap(output.output)
  return !value?.raw && !value?.error && value?.success !== false
}

// A tool error is written for the model. The stand-in turns it into the next step for the operator.
function missingStep(error) {
  if (/prices/.test(error)) return 'First type the new monthly and annual price in the approval card (New monthly, New annual). I cannot set a price: the comparison and the card use only those two boxes.'
  if (/cohort rule/.test(error)) return 'First confirm who to keep: pick one of the three founder readings in Strategy compare, or answer tag, signup month or launch.'
  return error
}

const RULE_NAMES = { tag: 'tagged "founder"', signup: 'signed up 2025-01 or earlier', source: 'came through the launch campaign' }

function statusText(v) {
  const kept = v.rules.find((r) => r.id === v.confirmedRule)?.members || []
  return `${v.subscribers.length} members in this bundle. Your rule keeps the ${kept.length} who ${RULE_NAMES[v.confirmedRule]} at their price: ${kept.join(', ')}. I can compare the two strategies, list the scheduled raises and the ten-day shifts, check a notice text, or report a finished run. Prices come only from the approval card, and only Approve & run writes to PayPal.`
}

const say = (text) => toResponse([textItem(text)])

// A count question about one group (annual, monthly, regular, founders) is answered from the scanned members.
const GROUPS = [
  { re: /annual|yearly|\byear\b/, name: 'on the annual plan', test: (s) => s.cycle === 'YEAR' },
  { re: /monthly|\bmonth plan\b/, name: 'on the monthly plan', test: (s) => s.cycle === 'MONTH' },
  { re: /\bregular/, name: 'tagged "regular"', test: (s) => s.tag === 'regular' },
]

export function countAnswer(lower, v) {
  const group = GROUPS.find((g) => g.re.test(lower))
  if (!group) return null
  const members = v.subscribers.filter(group.test)
  const prices = [...new Set(members.map((s) => s.price))].join(', ')
  const kept = v.rules.find((r) => r.id === v.confirmedRule)?.members || []
  const keptHere = members.filter((s) => kept.includes(s.label)).map((s) => s.label)
  const rule = v.confirmedRule ? ` Your rule keeps ${keptHere.length} of them at their price${keptHere.length ? ` (${keptHere.join(', ')})` : ''}.` : ''
  return `${members.length} of the ${v.subscribers.length} members are ${group.name}: ${members.map((s) => s.label).join(', ')}, paying ${prices || 'nothing'} today.${rule}`
}

// Questions outside the recorded run. Each answer either names where the operator acts or reads one tool first,
// so it is useful without a model and never invents a number.
function offScriptAnswer({ lower, items, has }) {
  const asksPrice = /\$\s?\d|\bprice to\b|\bto \d+(\.\d{1,2})?\b/.test(lower) && /raise|set|charge|change|make|lower|increase|put/.test(lower) && !/\bkeep\b/.test(lower)
  if (asksPrice) {
    return say('I cannot set or change a price, and nothing I say is written to PayPal. Type the new monthly and annual price in the approval card (New monthly, New annual); the comparison and the card use only those boxes. Members your rule keeps stay at their current price. To raise founders too, change the rule in Strategy compare so it does not keep them.')
  }
  if (/\b(run it|approve|execute|go ahead|do it|apply it)\b/.test(lower)) {
    return say('Only you can run it: choose A or B, check the approval card, then press Approve & run. I cannot write to PayPal. After the run every price is read back and shown in the Execution view.')
  }
  if (/difference|what('s| is) (strategy )?[ab]\b|explain (strategy )?[ab]\b/.test(lower)) {
    return say('Strategy A changes the plan price for everyone and first pins each kept member at the old price with an override, then reads every override back before the plan changes. Your checkout button stays the same. Strategy B leaves the old plan alone, creates a new plan for new signups and raises only the chosen members one by one. Kept members are never written. It needs a checkout button change. The eight rows in Strategy compare show the cost of each for this bundle.')
  }
  if (/fail|error|undo|roll ?back|what if|safe|wrong/.test(lower)) {
    return say('If a keep-override does not read back, strategy A stops and the plan price is not changed. If PayPal\'s answer to a write is lost, that step is marked unknown and the run stops instead of writing again. The same plan cannot run twice, and a used bundle is read-only, because a PayPal override cannot be removed. If the members changed after you prepared the card, nothing is written and you are asked to review again.')
  }
  if (/ten.?day|10.?day|notice window|\bwindow\b|schedul|when (will|do|does)/.test(lower) && has('get_schedule_preview')) {
    const preview = outputOf(items, 'get_schedule_preview')
    if (!preview.called) return toResponse([toolCallItem('get_schedule_preview', {})])
    const v = preview.value
    if (v.error) return say(missingStep(v.error))
    const list = (v.scheduled || []).map((s) => `${s.member} on ${s.runOn} (${s.noticeDays} days notice)`).join(', ') || 'none'
    const outside = (v.outsideWindow || []).map((o) => o.label).join(', ') || 'none'
    return say(`PayPal ignores a price change when the next charge is 10 days away or less, so those members move to the next cycle. For strategy ${v.strategy}: shifted by the ten-day rule: ${v.tenDayShifted.join(', ') || 'none'}. Scheduled raises: ${list}. Outside your notice window: ${outside}.`)
  }
  if (/how many|who (is|are|gets|stays)|which members|list (the )?members|members are/.test(lower) && has('scan_subscribers')) {
    const scan = outputOf(items, 'scan_subscribers')
    if (!scan.called) return toResponse([toolCallItem('scan_subscribers', {})])
    const v = scan.value
    const counted = countAnswer(lower, v)
    if (counted) return say(counted)
    if (v.confirmedRule) return say(statusText(v))
    const counts = v.rules.map((r) => `${RULE_NAMES[r.id]}: ${r.members.length} (${r.members.join(', ')})`).join('; ')
    return say(`${v.subscribers.length} members. Founders by each reading: ${counts}. The readings disagree on ${v.conflictCount} members. Pick one in Strategy compare.`)
  }
  return null
}

export function mockLlmTurn(request) {
  const input = request.input || []
  const text = lastUserText(input)
  const lower = text.toLowerCase()
  const items = turnItems(input)
  const toolNames = (request.tools || []).map((t) => t.name)
  const has = (name) => toolNames.includes(name)

  const wantsWidget = /\b(widget|chart|show|plot|make it|mint|color|colour)\b/.test(lower) && !/strategy|compare|schedule|report|notice|window/.test(lower)
  if (wantsWidget) {
    const delegate = (request.tools || []).find((t) => /delegate/i.test(t.name))
    const done = items.find((i) => i.type === 'function_call_output')
    if (delegate && !done) return toResponse([toolCallItem(delegate.name, delegateArgs(delegate, text))])
    if (done) return toResponse([textItem(delegateSucceeded(done) ? 'The widget agent finished. Check the dashboard.' : 'The widget agent could not run in stand-in mode, so no widget was made. Add an Anthropic key to use it.')])
    return toResponse([textItem('I can ask the built-in widget agent to do that once it is available.')])
  }

  const offScript = offScriptAnswer({ lower, items, has })
  if (offScript) return offScript

  const chosen = Object.entries(ruleWords).find(([, re]) => re.test(lower))
  const answering = chosen && lower.trim().split(/\s+/).length <= 4 && !/founder/.test(lower.replace(/tag/, ''))
  if (answering && has('propose_cohort_rules')) {
    const proposed = outputOf(items, 'propose_cohort_rules')
    if (!proposed.called) return toResponse([toolCallItem('propose_cohort_rules', { rules: [{ id: chosen[0], reason: 'Operator choice' }], selected: chosen[0] })])
    return toResponse([textItem(`Saved as a draft: founders by ${chosen[0]}. Confirm it in the desk header ("Use this rule") and I will compare the two strategies.`)])
  }

  if (/email|checkout|strateg|compare|recommend|which/.test(lower) && has('compare_strategies')) {
    const noCheckout = /can't touch|cannot touch|can't change|checkout/.test(lower)
    const result = outputOf(items, 'compare_strategies')
    if (!result.called) return toResponse([toolCallItem('compare_strategies', { preference: noCheckout ? 'no_checkout_change' : /email/.test(lower) ? 'no_emails_to_kept' : 'none' })])
    const v = result.value
    if (v.error) return toResponse([textItem(missingStep(v.error))])
    const row = (m) => v.rows.find((r) => r.metric.startsWith(m)) || { A: '?', B: '?' }
    const rec = v.defaultRecommendation
    const reason = rec === 'B'
      ? `Strategy B touches no kept member (${row('Overrides').B} overrides left vs ${row('Overrides').A}), sends ${row('Plan emails').B} plan emails vs ${row('Plan emails').A}, and has ${row('Outside').B} members outside your notice window vs ${row('Outside').A}. It needs a checkout change, so pick A if you cannot touch the button this month.`
      : `Strategy A keeps your checkout as is (checkout change: ${row('Checkout').A}). The cost: ${row('Overrides').A} overrides left, ${row('Plan emails').A} plan emails and ${row('Outside').A} member outside your window.`
    const cap = v.notes.length ? ` Note: ${v.notes[0]}` : ''
    return toResponse([textItem(`Recommendation: ${rec}. ${reason} MRR change is ${row('MRR').B} either way (computed).${cap}`)])
  }

  if (/notice|message|email text|draft/.test(lower) && has('get_schedule_preview')) {
    const preview = outputOf(items, 'get_schedule_preview')
    if (!preview.called) return toResponse([toolCallItem('get_schedule_preview', {})])
    const list = (preview.value.scheduled || []).map((s) => `${s.member} on ${s.runOn}`).join(', ') || 'nothing is scheduled'
    return toResponse([textItem(`Notice texts are filled by code with the exact dates and prices. Scheduled raises: ${list}. Use "Export notice CSV" in the Execution view.`)])
  }

  if (/report|what happened|did it work|result/.test(lower) && has('get_execution_report')) {
    const report = outputOf(items, 'get_execution_report')
    if (!report.called) return toResponse([toolCallItem('get_execution_report', {})])
    const v = report.value
    return toResponse([textItem(v.executed ? `Strategy ${v.strategy}: ${v.ok ? `every price read back from ${v.readBackFrom || 'the PayPal stand-in'} as planned` : v.error}. Scheduled raises are not run yet.` : 'Nothing has run yet.')])
  }

  if (has('scan_subscribers')) {
    const scan = outputOf(items, 'scan_subscribers')
    if (!scan.called) return toResponse([toolCallItem('scan_subscribers', {})])
    const v = scan.value
    const tagRule = v.rules.find((r) => r.id === 'tag')
    const signupRule = v.rules.find((r) => r.id === 'signup')
    const proposed = outputOf(items, 'propose_cohort_rules')
    if (!proposed.called && !v.confirmedRule) {
      return toResponse([toolCallItem('propose_cohort_rules', { rules: v.rules.slice(0, 3).map((r) => ({ id: r.id, reason: `${r.members.length} members` })) })])
    }
    if (v.confirmedRule) return toResponse([textItem(statusText(v))])
    const who = v.conflicts.map((c) => c.label).join(', ')
    return toResponse([textItem(`"Founders" can be read 3 ways and they disagree on ${v.conflictCount} subscribers (${who}). By tag: ${tagRule.members.join(', ')}. By signup month 2025-01 or earlier: ${signupRule.members.join(', ')}. By launch campaign: ${v.rules.find((r) => r.id === 'source').members.join(', ')}. Which one should I keep at the old price? (tag / signup month / launch)`)])
  }
  return toResponse([textItem('Tell me who to keep at the old price, for example "keep founders at $9, raise regular monthly to $12".')])
}
