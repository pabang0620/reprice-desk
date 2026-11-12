// Sandbox evidence: only the checks that passed against the real PayPal sandbox or the real model (VERIFY.md).
function Rows({ items }) {
  return (
    <ul className="rd-evidence-list">
      {items.map((item) => (
        <li key={item.id}>
          <span className="rd-mono rd-evidence-id">{item.id}</span>
          <span className={item.result.startsWith('PASS') ? 'rd-pill rd-pill-mint' : 'rd-pill rd-pill-amber'}>{item.result}</span>
          <span>{item.text}</span>
        </li>
      ))}
    </ul>
  )
}

export default function EvidencePanel({ evidence, onClose }) {
  if (!evidence) return null
  return (
    <aside className="rd-evidence" role="dialog" aria-label="Sandbox evidence">
      <div className="rd-evidence-head">
        <strong>Sandbox evidence</strong>
        <span className="rd-foot">checks run on {evidence.ranOn}, full rows in VERIFY.md</span>
        <button className="rd-tab" onClick={onClose}>Close</button>
      </div>
      <h4>PayPal sandbox</h4>
      <Rows items={evidence.sandbox} />
      <h4>Real model (Claude Sonnet through the local Claude Code account, no API key)</h4>
      <Rows items={evidence.model} />
      <p className="rd-foot">{evidence.notClaimed}</p>
    </aside>
  )
}
