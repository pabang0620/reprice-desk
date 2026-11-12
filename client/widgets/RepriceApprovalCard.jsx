import { useState } from 'react'
import { actions, useDesk } from '../deskStore.js'

function PriceInput({ label, value, onCommit, disabled, placeholder = '' }) {
  const [text, setText] = useState(value == null ? '' : String(value))
  const commit = () => { const n = Number(text); if (text.trim() && n > 0) onCommit(n) }
  return (
    <label className="rd-field">
      <span>{label}</span>
      <input className="rd-input rd-mono" inputMode="decimal" value={text} placeholder={placeholder} disabled={disabled} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit() }} />
    </label>
  )
}

const money = (cents) => (cents == null ? null : (cents / 100).toFixed(2))
const nowPrice = (view, interval) => {
  const plan = view.plans.find((p) => p.interval === interval)
  return plan ? ` (now $${money(plan.priceCents)})` : ''
}

// The money summary first: how many are raised, how many keep their price, and the computed MRR change.
function BigSum({ shown }) {
  return (
    <div className="rd-big-sum">
      <div className="is-raise"><b>{shown.raise}</b><span>raised</span></div>
      <div className="is-keep"><b>{shown.keep}</b><span>kept at old price</span></div>
      <div><b>{shown.mrr.before}<small>to</small>{shown.mrr.after}</b><span className="rd-mrr-label">MRR, computed ({shown.mrr.delta})</span></div>
    </div>
  )
}

const WHEN_TONE = { now: 'rd-st-captured', scheduled: 'rd-st-pending', 'after run': 'rd-st-held' }

// What PayPal will do: the frozen plan's steps grouped by PayPal call, with the webhooks to expect right away.
function PaypalWillDo({ paypal, done }) {
  return (
    <div className="rd-pp" data-testid="paypal-will-do">
      <h4>What PayPal will do<span>{paypal.now} writes now, {paypal.scheduled} scheduled{done ? ' (ran)' : ''}</span></h4>
      <table className="rd-table">
        <thead><tr><th>PayPal call</th><th>What</th><th>When</th><th className="rd-pp-count">Calls</th></tr></thead>
        <tbody>
          {paypal.rows.map((r) => (
            <tr key={`${r.call}-${r.what}`}>
              <td>{r.call}</td>
              <td>{r.what}</td>
              <td><span className={`rd-st ${WHEN_TONE[r.when]}`}>{r.when}</span></td>
              <td className="rd-pp-count">{r.count ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="rd-foot rd-mono">Expected webhooks now: {paypal.webhooks}</p>
    </div>
  )
}

export default function RepriceApprovalCard() {
  const { view, card, busy, error } = useDesk()
  if (!view) return <div className="rd-widget">Open a bundle first.</div>
  const locked = Boolean(view.execution)
  const inputs = view.inputs
  const shown = card?.card || view.cards?.[view.execution?.strategy || view.recommended]
  const strategy = card?.strategy || view.execution?.strategy || view.recommended
  return (
    <div className="rd-widget rd-approval">
      <div className="rd-w-head rd-card-title">
        <h3>Approval card, strategy {strategy}</h3>
        <span className="rd-w-sub">{card ? 'frozen, ready to approve' : '(preview, choose a strategy to freeze it)'}</span>
      </div>
      {shown && <BigSum shown={shown} />}
      <div className="rd-inputs rd-inputs-4">
        <PriceInput key={`${view.sessionId}-m`} label={`New monthly${nowPrice(view, 'MONTH')}`} placeholder="type a price" value={money(inputs.monthlyCents)} disabled={locked || busy} onCommit={(n) => actions.setInputs({ monthly: n })} />
        <PriceInput key={`${view.sessionId}-a`} label={`New annual${nowPrice(view, 'YEAR')}`} placeholder="type a price" value={money(inputs.annualCents)} disabled={locked || busy} onCommit={(n) => actions.setInputs({ annual: n })} />
        <PriceInput key={`${view.sessionId}-min`} label="Notice min days" value={inputs.minDays} disabled={locked || busy} onCommit={(n) => actions.setInputs({ minDays: Math.round(n) })} />
        <PriceInput key={`${view.sessionId}-max`} label="Notice max days" value={inputs.maxDays} disabled={locked || busy} onCommit={(n) => actions.setInputs({ maxDays: Math.round(n) })} />
      </div>
      {(strategy === 'A' && (inputs.overrideOutside || shown?.lines.some((l) => l.startsWith('Outside window:') && l !== 'Outside window: none'))) && (
        <label className="rd-toggle rd-fix">
          <input type="checkbox" checked={Boolean(inputs.overrideOutside)} disabled={locked || busy} onChange={(ev) => actions.setInputs({ overrideOutside: ev.target.checked })} />
          {' '}Override these members now at their current price and raise them later by a scheduled PATCH, so they get the full notice window
        </label>
      )}
      <p className="rd-foot">Prices come from these boxes only. A model can suggest, but the code never reads a price from it.</p>
      {!shown && <p className="rd-lead">{view.rule && view.pricesMissing ? 'Type both new prices, then the plan appears here.' : 'Confirm who to keep and type both new prices, then the plan appears here.'}</p>}
      {shown && (
        <>
          <ul className="rd-lines">{shown.lines.map((l) => <li key={l}>{l}</li>)}</ul>
          {shown.notes.map((n) => <p key={n} className="rd-foot rd-warn">{n}</p>)}
        </>
      )}
      {card && !locked && (
        <>
          <p className="rd-foot">Approving re-reads the subscribers. If they changed since the card was frozen, nothing is written ("Review again").</p>
        </>
      )}
      {card?.card?.paypal && <PaypalWillDo paypal={card.card.paypal} done={locked} />}
      {error && <p className="rd-error" role="alert">{error}</p>}
      <div className="rd-apr-foot">
        {view.readOnly ? (
          <p className="rd-error">No fresh sandbox bundle left. Watch the recorded run. Planning and comparing still work.</p>
        ) : locked ? (
          <p className="rd-ok">This bundle ran. It is read-only now. Open a new bundle to try another plan.</p>
        ) : (
          <>
            <button className="rd-btn rd-btn-primary rd-big" disabled={busy || !card || Boolean(shown?.waitUntil)} onClick={() => actions.run()}>
              {busy ? 'Working...' : 'Approve & run'}
            </button>
            {card ? <p className="rd-approver"><span className="rd-approver-k">Approves</span><span>You, the desk owner. The Reprice Agent cannot press this button. Plans and prices only, no cancel, pause or refund.</span></p> : <p className="rd-foot">Choose a strategy to freeze this card. You approve; the agent cannot.</p>}
          </>
        )}
      </div>
    </div>
  )
}
