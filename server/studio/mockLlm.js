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

export function mockLlmTurn(request) {
  const input = request.input || []
  const text = lastUserText(input)
  const lower = text.toLowerCase()
  const items = turnItems(input)
  const toolNames = (request.tools || []).map((t) => t.name)
  const has = (name) => toolNames.includes(name)

  const wantsWidget = /\b(widget|chart|show|plot|make it|mint|color|colour)\b/.test(lower) && !/strategy|compare/.test(lower)
  if (wantsWidget) {
    const delegate = (request.tools || []).find((t) => /delegate/i.test(t.name))
    const done = items.find((i) => i.type === 'function_call_output')
    if (delegate && !done) return toResponse([toolCallItem(delegate.name, delegateArgs(delegate, text))])
    if (done) return toResponse([textItem(delegateSucceeded(done) ? 'The widget agent finished. Check the dashboard.' : 'The widget agent could not run in stand-in mode, so no widget was made. Add an Anthropic key to use it.')])
    return toResponse([textItem('I can ask the built-in widget agent to do that once it is available.')])
  }

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
    if (v.error) return toResponse([textItem(v.error)])
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
    return toResponse([textItem(v.executed ? `Strategy ${v.strategy}: ${v.ok ? 'every price read back from PayPal as planned' : v.error}. Scheduled raises are not run yet.` : 'Nothing has run yet.')])
  }

  if (has('scan_subscribers')) {
    const scan = outputOf(items, 'scan_subscribers')
    if (!scan.called) return toResponse([toolCallItem('scan_subscribers', {})])
    const v = scan.value
    const tagRule = v.rules.find((r) => r.id === 'tag')
    const signupRule = v.rules.find((r) => r.id === 'signup')
    const proposed = outputOf(items, 'propose_cohort_rules')
    if (!proposed.called) {
      return toResponse([toolCallItem('propose_cohort_rules', { rules: v.rules.slice(0, 3).map((r) => ({ id: r.id, reason: `${r.members.length} members` })) })])
    }
    const who = v.conflicts.map((c) => c.label).join(', ')
    return toResponse([textItem(`"Founders" can be read 3 ways and they disagree on ${v.conflictCount} subscribers (${who}). By tag: ${tagRule.members.join(', ')}. By signup month 2025-01 or earlier: ${signupRule.members.join(', ')}. By launch campaign: ${v.rules.find((r) => r.id === 'source').members.join(', ')}. Which one should I keep at the old price? (tag / signup month / launch)`)])
  }
  return toResponse([textItem('Tell me who to keep at the old price, for example "keep founders at $9, raise regular monthly to $12".')])
}
