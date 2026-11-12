import { useDesk } from '../deskStore.js'
import { useWidgetRows } from './useWidgetRows.js'

const KEYS = ['member', 'days', 'cohort']

const SCALE_DAYS = 70
const ROW = 22
const LEFT = 36
const W = 640

// Reads the subscribers source through the Studio data engine, so Filters and cross filters change which members it shows.
export default function NoticeWindowStrip(params) {
  const { view } = useDesk()
  const { rows: found, error } = useWidgetRows(params, KEYS)
  if (!view) return <div className="rd-widget">Open a bundle first.</div>
  if (error) return <div className="rd-widget rd-warn">{error}</div>
  if (!found) return <div className="rd-widget">Loading members...</div>
  const order = new Map(view.subs.map((x, i) => [x.label, i]))
  const rows = [...found].sort((a, b) => (order.get(a.member) ?? 99) - (order.get(b.member) ?? 99))
  const { minDays, maxDays } = view.inputs
  const x = (d) => LEFT + (Math.min(d, SCALE_DAYS) / SCALE_DAYS) * (W - LEFT - 40)
  const h = Math.max(rows.length, 1) * ROW + 26
  return (
    <div className="rd-widget">
      <div className="rd-card-title">Notice windows <span className="rd-foot">days from today to each next charge</span></div>
      <svg viewBox={`0 0 ${W} ${h}`} className="rd-svg" role="img" aria-label="Days until each member's next charge">
        <rect x={x(0)} y={0} width={x(10) - x(0)} height={h - 18} className="rd-zone-ten" />
        <rect x={x(minDays)} y={0} width={x(Math.min(maxDays, SCALE_DAYS)) - x(minDays)} height={h - 18} className="rd-zone-window" />
        {rows.map((s, i) => (
          <g key={s.member} transform={`translate(0 ${i * ROW + 4})`}>
            <text x={2} y={12} className="rd-axis rd-mono">{s.member}</text>
            <line x1={x(0)} x2={x(s.days)} y1={8} y2={8} className={String(s.cohort).toLowerCase() === 'raised' ? 'rd-bar-amber' : 'rd-bar-mint'} />
            <circle cx={x(s.days)} cy={8} r={4} className="rd-dot" />
            <text x={x(s.days) + 8} y={12} className="rd-axis rd-mono">{s.days > SCALE_DAYS ? `${s.days}d >` : `${s.days}d`}</text>
          </g>
        ))}
        {[0, 10, 30, 60].map((d) => <text key={d} x={x(d)} y={h - 4} className="rd-axis rd-mono" textAnchor="middle">{d}</text>)}
      </svg>
      <div className="rd-legend">
        <span className="rd-pill rd-pill-dim">0-10d: PayPal ignores a price change</span>
        <span className="rd-pill rd-pill-window">{minDays}-{maxDays}d: your notice window</span>
      </div>
    </div>
  )
}
