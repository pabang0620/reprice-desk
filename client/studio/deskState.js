// The desk state the Reprice Agent must know on every model turn. Studio re-resolves the agent's instructions per
// request, so this paragraph is always current: once the operator confirms the founder rule in the desk, the model
// reads "confirmed" here even in turns whose tool results (delegations to built-in agents) never mention the rule.

const RULE_TEXT = {
  tag: 'members tagged "founder"',
  signup: 'members who signed up 2025-01 or earlier',
  source: 'members who came through the launch campaign',
}

const dollars = (cents) => `$${(cents / 100).toFixed(2)}`

export function deskStateText(view) {
  if (!view) return 'Current desk state: no bundle is open yet.'
  const lines = ['Current desk state (read from the desk just now; it replaces anything said earlier in the chat):']
  if (view.rule) {
    const kept = view.cohort?.byRule?.[view.rule] || []
    lines.push(`- Founder rule: CONFIRMED by the operator in the desk. Kept at their price: the ${kept.length} ${RULE_TEXT[view.rule]} (${kept.join(', ')}). It is not a draft any more. Do not call it a draft and do not ask the operator to confirm it again.`)
  } else if (view.ruleDraft) {
    lines.push('- Founder rule: a draft only. The operator has not confirmed it in the desk yet.')
  } else {
    lines.push('- Founder rule: not chosen yet.')
  }
  lines.push(view.pricesMissing
    ? '- New prices: not typed yet. The operator types them in the approval card.'
    : `- New prices: typed by the operator in the approval card: monthly ${dollars(view.inputs.monthlyCents)}, annual ${dollars(view.inputs.annualCents)}.`)
  if (view.execution) lines.push(`- Run: strategy ${view.execution.strategy} has run on this bundle (${view.execution.ok ? 'every price read back as planned' : 'stopped, see the run report'}).`)
  else if (view.approval?.strategy || view.strategy) lines.push(`- Strategy on the approval card: ${view.approval?.strategy || view.strategy}. Not run yet; only the operator can press Approve & run.`)
  else lines.push('- Strategy: not chosen yet.')
  return lines.join('\n')
}
