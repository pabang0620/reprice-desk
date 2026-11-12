// Three readings of "founders". The code counts where they disagree so the agent can ask with evidence.
export const FOUNDER_SIGNUP_CUTOFF = '2025-01'

export function parseCustomId(customId) {
  const [tag = 'regular', signupMonth = '', source = 'web'] = String(customId || '').split('|')
  return { tag, signupMonth, source }
}

export const COHORT_RULES = {
  tag: { id: 'tag', label: 'Tagged founder', test: (s) => s.tag === 'founder' },
  signup: { id: 'signup', label: `Signed up ${FOUNDER_SIGNUP_CUTOFF} or earlier`, test: (s) => s.signupMonth !== '' && s.signupMonth <= FOUNDER_SIGNUP_CUTOFF },
  source: { id: 'source', label: 'Came through the launch campaign', test: (s) => s.source === 'launch' },
}

export function ruleMembers(ruleId, subs) {
  const rule = COHORT_RULES[ruleId]
  if (!rule) throw new Error(`Unknown cohort rule: ${ruleId}`)
  return subs.filter((s) => rule.test(s)).map((s) => s.label)
}

export function cohortReport(subs) {
  const byRule = {}
  for (const id of Object.keys(COHORT_RULES)) byRule[id] = ruleMembers(id, subs)
  const conflicts = subs
    .filter((s) => {
      const votes = Object.values(COHORT_RULES).map((r) => r.test(s))
      return votes.some(Boolean) && !votes.every(Boolean)
    })
    .map((s) => ({
      label: s.label,
      tag: s.tag,
      signupMonth: s.signupMonth,
      source: s.source,
      founderBy: Object.values(COHORT_RULES).filter((r) => r.test(s)).map((r) => r.id),
    }))
  return { byRule, conflicts, conflictLabels: conflicts.map((c) => c.label) }
}

// Founders are kept at their price. Everyone else is raised.
export function intentFromRule(ruleId, subs) {
  const rule = COHORT_RULES[ruleId]
  if (!rule) throw new Error(`Unknown cohort rule: ${ruleId}`)
  return Object.fromEntries(subs.map((s) => [s.id, rule.test(s) ? 'keep' : 'raise']))
}
