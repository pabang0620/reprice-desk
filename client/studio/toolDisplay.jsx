// How the Reprice Agent's tool calls look in the chat panel (AG Studio `aiToolDisplay`).
// The compare tool opens into the same eight code-computed metrics the Strategy compare widget shows.
function CompareDetail({ result }) {
  const rows = result?.data?.rows
  if (!rows) return <p className="rd-foot">{result?.success === false ? 'The tool returned an error.' : 'Waiting for the result...'}</p>
  return (
    <table className="rd-table rd-mini">
      <thead><tr><th>Metric</th><th>A</th><th>B</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.metric}><td>{r.metric}</td><td>{r.A}</td><td>{r.B}</td></tr>)}</tbody>
    </table>
  )
}

function ScanDetail({ result }) {
  const data = result?.data
  if (!data) return null
  return <p className="rd-foot">{data.subscribers?.length} subscribers read. The three founder readings disagree on {data.conflictCount}: {(data.conflicts || []).join(', ')}.</p>
}

export const aiToolDisplay = {
  scan_subscribers: { label: ({ status, result }) => ({ text: status === 'done' ? 'Read the subscribers' : 'Reading the subscribers', pill: result?.data ? `${result.data.conflictCount} conflicts` : undefined }), detail: ScanDetail },
  propose_cohort_rules: { label: () => ({ text: 'Saved a draft of the founder rule' }) },
  compare_strategies: { label: ({ result }) => ({ text: 'Compared strategy A and B', pill: result?.data?.rows ? `${result.data.rows.length} metrics` : undefined }), detail: CompareDetail },
  get_schedule_preview: { label: () => ({ text: 'Read the scheduled raises' }) },
  draft_notice: { label: () => ({ text: 'Drafted a member notice' }) },
  get_execution_report: { label: () => ({ text: 'Read the execution report' }) },
}
