import { actions, useDesk } from '../deskStore.js'

const RULE_LABELS = {
  tag: 'Tagged "founder"',
  signup: 'Signed up 2025-01 or earlier',
  source: 'Came through the launch campaign',
}

function RulePicker({ view, busy }) {
  const draft = view.ruleDraft
  const conflicts = view.cohort.conflictLabels
  return (
    <div className="rd-rulepicker">
      <p className="rd-lead">
        Who are your founders? The three readings disagree on <strong>{conflicts.length}</strong> subscribers ({conflicts.join(', ')}).
      </p>
      {draft?.selected && (
        <p className="rd-agent-note">Reprice Agent drafted: <strong>{RULE_LABELS[draft.selected]}</strong>. Nothing is computed until you confirm.</p>
      )}
      <div className="rd-rule-buttons">
        {Object.keys(RULE_LABELS).map((id) => (
          <button key={id} className={draft?.selected === id ? 'rd-btn rd-btn-primary' : 'rd-btn'} disabled={busy || view.execution} onClick={() => actions.setRule(id)}>
            {draft?.selected === id ? 'Use this rule: ' : ''}{RULE_LABELS[id]} ({view.cohort.byRule[id].length})
          </button>
        ))}
      </div>
    </div>
  )
}

function better(row, side) {
  const a = row.numA ?? row.A
  const b = row.numB ?? row.B
  if (typeof a !== 'number' || typeof b !== 'number' || a === b) return false
  return row.lowerIsBetter ? (side === 'A' ? a < b : b < a) : (side === 'A' ? a > b : b > a)
}

export default function StrategyCompare() {
  const { view, busy } = useDesk()
  if (!view) return <div className="rd-widget">Open a bundle first.</div>
  if (!view.compare && !view.rule) return <div className="rd-widget"><div className="rd-w-head"><h3>Who to keep</h3><span className="rd-w-sub">confirm a rule, nothing is computed before</span></div><RulePicker view={view} busy={busy} /></div>
  if (!view.compare) {
    return (
      <div className="rd-widget rd-compare">
        <div className="rd-w-head"><h3>Strategy compare</h3><span className="rd-w-sub">eight code-computed metrics</span></div>
        <div className="rd-compare-head">
          <span>Rule: <strong>{RULE_LABELS[view.rule]}</strong></span>
          <button className="rd-link" onClick={() => actions.setRule(view.rule === 'tag' ? 'signup' : 'tag')}>change</button>
        </div>
        <p className="rd-lead" data-testid="prices-needed">Type the new monthly and annual price in the approval card. The two strategies are computed from your prices only.</p>
      </div>
    )
  }
  const chosen = view.strategy
  return (
    <div className="rd-widget rd-compare">
      <div className="rd-w-head"><h3>Strategy compare</h3><span className="rd-w-sub">eight code-computed metrics</span></div>
      <div className="rd-compare-head">
        <span>Rule: <strong>{RULE_LABELS[view.rule]}</strong></span>
        {!view.execution && <button className="rd-link" onClick={() => actions.setRule(view.rule === 'tag' ? 'signup' : 'tag')}>change</button>}
      </div>
      <table className="rd-table">
        <thead>
          <tr><th /><th className={chosen === 'A' ? 'rd-col-on' : ''}>A: raise the plan + keep-overrides</th><th className={chosen === 'B' ? 'rd-col-on' : ''}>B: new plan + raise chosen members</th></tr>
        </thead>
        <tbody>
          {view.compare.rows.map((row) => (
            <tr key={row.id}>
              <td>{row.label}</td>
              <td className={better(row, 'A') ? 'rd-better' : ''}>{row.A}</td>
              <td className={better(row, 'B') ? 'rd-better' : ''}>{row.B}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {view.recommendedReason && <p className="rd-agent-note" data-testid="recommend-reason"><strong>Recommended: {view.recommended}.</strong> {view.recommendedReason}</p>}
      {view.findings.v9 == null && <p className="rd-foot">V9 and V4 are not verified in the sandbox yet, so email counts are shown as pending.</p>}
      {view.compare.A.notes.concat(view.compare.B.notes).map((n) => <p key={n} className="rd-foot rd-warn">{n}</p>)}
      <div className="rd-choose">
        {['A', 'B'].map((s) => (
          <button key={s} className={chosen === s ? 'rd-btn rd-btn-primary' : 'rd-btn'} disabled={busy || view.execution} onClick={() => actions.prepare(s)}>
            Choose {s}{view.recommended === s ? ' (default pick)' : ''}
          </button>
        ))}
      </div>
    </div>
  )
}
