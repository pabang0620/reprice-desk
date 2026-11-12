import { useState } from 'react'
import { actions, deskStore, useDesk } from '../deskStore.js'
import { chipTone, keptSummary, sourceName } from './keptSummary.js'

// Scheduled raises wait for their real dates (inside the notice window). Say which one is next and when.
function nothingDue(jobs) {
  const next = [...jobs].filter((j) => j.status === 'pending').sort((a, b) => a.runOn.localeCompare(b.runOn))[0]
  return next ? `Nothing is due today. Next: ${next.label} on ${next.runOn}; the hourly scheduler runs it then.` : 'Nothing is due today.'
}

const deskStateJobs = () => deskStore.get().view?.execution?.jobs || []

export default function NextSteps() {
  const { view, sessionId, busy } = useDesk()
  const [msg, setMsg] = useState('')
  if (!view) return <div className="rd-widget">Open a bundle first.</div>
  const e = view.execution
  const kept = e ? keptSummary(e.readBack, e.source) : null
  return (
    <div className="rd-widget">
      <div className="rd-w-head rd-card-title">What to do next</div>
      {!e && <p className="rd-lead">Nothing has run yet. Approve a plan first.</p>}
      {e && (
        <>
          <p className={e.ok ? 'rd-ok' : 'rd-error'}>{e.ok ? `Strategy ${e.strategy}: every price read back from ${sourceName(e.source)} as planned.` : e.error}</p>
          {kept && <p className={kept.ok ? 'rd-proof' : 'rd-proof rd-error'} data-testid="kept-proof">{kept.text}</p>}
          <div className="rd-readback">
            {e.readBack.map((r) => (
              <span key={r.label} className={`rd-chip rd-chip-${chipTone(r)}`}>
                {r.label} ${(r.priceCents / 100).toFixed(2)}{r.overridden ? ' override' : ''}
              </span>
            ))}
          </div>
          {e.newPlans.length > 0 && (
            <div className="rd-note">
              Switch your checkout button to the new plan IDs:
              <ul>{e.newPlans.map((p) => <li key={p.planId} className="rd-mono">{p.interval === 'YEAR' ? 'Annual' : 'Monthly'}: {p.planId}</li>)}</ul>
            </div>
          )}
          {e.jobs.length > 0 && <p className="rd-lead">Scheduled, not yet run: {e.jobs.map((j) => `${j.label} on ${j.runOn} (${j.status})`).join(', ')}</p>}
        </>
      )}
      <div className="rd-choose">
        <a className="rd-btn" href={`/api/session/${sessionId}/notices.csv`} download="notices.csv">Export notice CSV</a>
        <button className="rd-btn" disabled={busy || !e || view.readOnly} onClick={async () => { const out = await actions.runScheduler(); setMsg(out?.length ? out.map((o) => `${o.label} ${o.status}`).join(', ') : nothingDue(deskStateJobs())) }}>Run due raises</button>
      </div>
      {msg && <p className="rd-foot">{msg}</p>}
      <label className="rd-toggle"><input type="checkbox" disabled /> Watch for dashboard price changes (next)</label>
    </div>
  )
}
