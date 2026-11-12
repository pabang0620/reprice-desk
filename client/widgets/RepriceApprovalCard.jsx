import { useState } from 'react'
import { actions, useDesk } from '../deskStore.js'

function PriceInput({ label, value, onCommit, disabled }) {
  const [text, setText] = useState(String(value))
  return (
    <label className="rd-field">
      <span>{label}</span>
      <input className="rd-input rd-mono" inputMode="decimal" value={text} disabled={disabled} onChange={(e) => setText(e.target.value)} onBlur={() => { const n = Number(text); if (n > 0) onCommit(n) }} />
    </label>
  )
}

export default function RepriceApprovalCard() {
  const { view, card, busy, error } = useDesk()
  if (!view) return <div className="rd-widget">Open a bundle first.</div>
  const locked = Boolean(view.execution)
  const inputs = view.inputs
  const shown = card && view.cards ? view.cards[card.strategy] : view.cards?.[view.recommended]
  const strategy = card?.strategy || view.recommended
  return (
    <div className="rd-widget rd-approval">
      <div className="rd-card-title">Approval card, strategy {strategy}{card ? '' : ' (preview, choose a strategy to freeze it)'}</div>
      <div className="rd-inputs">
        <PriceInput label="New monthly" value={(inputs.monthlyCents / 100).toFixed(2)} disabled={locked || busy} onCommit={(n) => actions.setInputs({ monthly: n })} />
        <PriceInput label="New annual" value={(inputs.annualCents / 100).toFixed(2)} disabled={locked || busy} onCommit={(n) => actions.setInputs({ annual: n })} />
        <PriceInput label="Notice min days" value={inputs.minDays} disabled={locked || busy} onCommit={(n) => actions.setInputs({ minDays: Math.round(n) })} />
        <PriceInput label="Notice max days" value={inputs.maxDays} disabled={locked || busy} onCommit={(n) => actions.setInputs({ maxDays: Math.round(n) })} />
      </div>
      {(strategy === 'A' && (inputs.overrideOutside || shown?.lines.some((l) => l.startsWith('Outside window:') && l !== 'Outside window: none'))) && (
        <label className="rd-toggle rd-fix">
          <input type="checkbox" checked={Boolean(inputs.overrideOutside)} disabled={locked || busy} onChange={(ev) => actions.setInputs({ overrideOutside: ev.target.checked })} />
          {' '}Override these members now at their current price and raise them later by a scheduled PATCH, so they get the full notice window
        </label>
      )}
      <p className="rd-foot">Prices come from these boxes only. A model can suggest, but the code never reads a price from it.</p>
      {!shown && <p className="rd-lead">Confirm who to keep, then the plan appears here.</p>}
      {shown && (
        <>
          <div className="rd-card-head">
            <span className="rd-pill rd-pill-amber">Raise {shown.raise}</span>
            <span className="rd-pill rd-pill-mint">Keep {shown.keep}</span>
            <span className="rd-mrr rd-mono">MRR {shown.mrr.before} to {shown.mrr.after} ({shown.mrr.delta}, computed)</span>
          </div>
          <ul className="rd-lines">{shown.lines.map((l) => <li key={l}>{l}</li>)}</ul>
        </>
      )}
      {error && <p className="rd-error" role="alert">{error}</p>}
      {view.readOnly ? (
        <p className="rd-error">No fresh sandbox bundle left. Watch the recorded run. Planning and comparing still work.</p>
      ) : locked ? (
        <p className="rd-ok">This bundle ran. It is read-only now. Open a new bundle to try another plan.</p>
      ) : (
        <button className="rd-btn rd-btn-primary rd-big" disabled={busy || !card} onClick={() => actions.run()}>
          {busy ? 'Working...' : 'Approve & run'}
        </button>
      )}
    </div>
  )
}
