import { useEffect, useState } from 'react'
import { actions, useDesk } from './deskStore.js'
import DeskStudio from './studio/DeskStudio.jsx'
import EvidencePanel from './EvidencePanel.jsx'

function llmMode(config) {
  const llm = config?.modes.llm
  if (llm === 'account') return 'Claude Sonnet (local account)'
  if (llm === 'live') return 'Claude Sonnet (API key)'
  if (config?.recordedRun) return `stand-in that replays a recorded real run (${config.recordedRun.label}); questions outside the recording get a scripted stand-in, labelled as such`
  return 'stand-in'
}

function Start({ config, busy, error, onEvidence }) {
  const left = config?.freshBundlesLeft
  return (
    <main className="rd-start">
      <h1>Reprice Desk</h1>
      <p className="rd-tag">Raise prices on PayPal Subscriptions, on purpose.</p>
      <div className="rd-start-card">
        <p>Your {config?.modes.paypal === 'sandbox' ? 'PayPal sandbox' : 'stand-in'} bundle: <strong>2 plans, 12 subscribers</strong> (pre-seeded).</p>
        <p className="rd-foot">Fresh bundles left: <strong data-testid="bundles-left">{left ?? '...'}</strong>. A bundle is used once because a PayPal override cannot be removed.</p>
        <p className="rd-foot">Every date and count on screen is computed from your bundle's real billing dates, so they can differ from the README example, which describes a bundle on its seed day.</p>
        <p className="rd-foot">Mode: PayPal {config?.modes.paypal === 'mock' ? 'stand-in (no credentials set)' : 'sandbox'}, Claude {llmMode(config)}.</p>
        {error ? (
          <>
            <button className="rd-btn rd-btn-primary rd-big" disabled={busy} onClick={() => actions.loadConfig()}>Retry connection</button>
            {config && <button className="rd-tab" disabled={busy} onClick={() => actions.open({ fresh: true })}>Start a new bundle instead</button>}
          </>
        ) : (
          <button className="rd-btn rd-btn-primary rd-big" disabled={busy || !config} onClick={() => actions.open()}>Open my bundle</button>
        )}
        <button className="rd-tab" disabled={!config} onClick={onEvidence}>Sandbox evidence</button>
        {error && <p className="rd-error" role="alert">{error}</p>}
      </div>
    </main>
  )
}

// Monthly revenue from the prices PayPal returned (annual plans counted per month).
function mrrOf(subs) {
  const cents = subs.reduce((sum, s) => sum + (s.interval === 'YEAR' ? s.priceCents / 12 : s.priceCents), 0)
  return `$${(cents / 100).toFixed(2)}`
}

// After a run some raises still wait for their date, so the card's MRR is higher than what PayPal bills today.
function afterScheduled(view) {
  const after = view.execution?.ok && view.cards?.[view.execution.strategy]?.mrr.after
  return after && after !== mrrOf(view.subs) ? `, ${after} after scheduled raises` : ''
}

export default function App() {
  const { config, view, busy, error, answerSource } = useDesk()
  const [showEvidence, setShowEvidence] = useState(false)
  useEffect(() => { actions.loadConfig() }, [])
  const evidence = showEvidence && <EvidencePanel evidence={config?.sandboxEvidence} onClose={() => setShowEvidence(false)} />
  if (!view) return <>{evidence}<Start config={config} busy={busy} error={error} onEvidence={() => setShowEvidence(true)} /></>
  return (
    <div className="rd-shell">
      <header className="rd-header">
        <strong className="rd-brand"><img className="brand-logo brand-logo--chip" src="/logo-512.png" width="28" height="28" alt="Reprice Desk" />Reprice Desk</strong>
        <span className="rd-header-meta rd-mono">
          {view.plans.map((p) => `${p.name} $${(p.priceCents / 100).toFixed(0)} (${view.subs.filter((s) => s.planId === p.id).length})`).join(' | ')} | MRR now {mrrOf(view.subs)}{afterScheduled(view)}
        </span>
        <span className="rd-pill rd-pill-dim">{view.readOnly ? 'Read-only copy' : view.mode === 'mock' ? 'Stand-in PayPal' : 'PayPal sandbox'}</span>
        <span className="rd-header-meta">Fresh bundles left: {view.freshBundlesLeft}</span>
        <span className="rd-header-meta">Seeded {view.bundle.seededAt.slice(0, 10)}, today {view.now}</span>
        {answerSource && <span className={answerSource.source === 'stand-in' ? 'rd-pill rd-pill-dim' : 'rd-pill rd-pill-mint'} data-testid="answer-source" title="Where the last chat answer came from">{answerSource.label}</span>}
        <button className="rd-tab" onClick={() => setShowEvidence(true)}>Sandbox evidence</button>
        {view.execution && <button className="rd-tab" disabled={busy} onClick={() => actions.open({ fresh: true })}>Open a new bundle</button>}
      </header>
      {evidence}
      <DeskStudio />
    </div>
  )
}
