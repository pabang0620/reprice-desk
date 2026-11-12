import { useEffect } from 'react'
import { actions, useDesk } from './deskStore.js'
import DeskStudio from './studio/DeskStudio.jsx'

function Start({ config, busy, error }) {
  const left = config?.freshBundlesLeft
  return (
    <main className="rd-start">
      <h1>Reprice Desk</h1>
      <p className="rd-tag">Raise prices on PayPal Subscriptions, on purpose.</p>
      <div className="rd-start-card">
        <p>Your sandbox bundle: <strong>2 plans, 12 subscribers</strong> (pre-seeded).</p>
        <p className="rd-foot">Fresh bundles left: <strong data-testid="bundles-left">{left ?? '...'}</strong>. A bundle is used once because a PayPal override cannot be removed.</p>
        <p className="rd-foot">Every date and count on screen is computed from your bundle's real billing dates, so they can differ from the README example, which describes a bundle on its seed day.</p>
        <p className="rd-foot">Mode: PayPal {config?.modes.paypal === 'mock' ? 'stand-in (no credentials set)' : 'sandbox'}, Claude {{ mock: 'stand-in', account: 'Claude Sonnet (local account)', live: 'Claude Sonnet (API key)' }[config?.modes.llm] || 'stand-in'}.</p>
        <button className="rd-btn rd-btn-primary rd-big" disabled={busy || !config} onClick={() => actions.open()}>Open my bundle</button>
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

export default function App() {
  const { config, view, busy, error } = useDesk()
  useEffect(() => { actions.loadConfig() }, [])
  if (!view) return <Start config={config} busy={busy} error={error} />
  return (
    <div className="rd-shell">
      <header className="rd-header">
        <strong>Reprice Desk</strong>
        <span className="rd-header-meta rd-mono">
          {view.plans.map((p) => `${p.name} $${(p.priceCents / 100).toFixed(0)} (${view.subs.filter((s) => s.planId === p.id).length})`).join(' | ')} | {view.execution ? 'MRR after run' : 'MRR now'} {mrrOf(view.subs)}
        </span>
        <span className="rd-pill rd-pill-dim">{view.readOnly ? 'Read-only copy' : view.mode === 'mock' ? 'Stand-in PayPal' : 'PayPal sandbox'}</span>
        <span className="rd-header-meta">Fresh bundles left: {view.freshBundlesLeft}</span>
        <span className="rd-header-meta">Seeded {view.bundle.seededAt.slice(0, 10)}, today {view.now}</span>
        {view.execution && <button className="rd-tab" disabled={busy} onClick={() => actions.open({ fresh: true })}>Open a new bundle</button>}
      </header>
      <DeskStudio />
    </div>
  )
}
