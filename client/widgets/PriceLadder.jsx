import { useDesk } from '../deskStore.js'
import { useWidgetRows } from './useWidgetRows.js'

const KEYS = ['member', 'strategy', 'month', 'cohort', 'price']
const MONTH_ORDER = (a, b) => String(a.month).localeCompare(String(b.month))

const W = 640
const H = 230
const PAD = { l: 44, r: 12, t: 12, b: 28 }

// Reads the price_timeline source through the Studio data engine, so Filters and cross filters change what it draws.
export default function PriceLadder(params) {
  const { view, card } = useDesk()
  const { rows: all, error } = useWidgetRows(params, KEYS)
  if (!view?.compare) return <div className="rd-widget">Confirm who to keep to see the price ladder.</div>
  if (error) return <div className="rd-widget rd-warn">{error}</div>
  if (!all) return <div className="rd-widget">Loading prices...</div>
  const strategy = card?.strategy || view.strategy || view.recommended
  const rows = all.filter((r) => r.strategy === strategy).sort(MONTH_ORDER)
  if (!rows.length) return <div className="rd-widget">No members match the current filter.</div>
  const annual = new Set(view.subs.filter((s) => s.interval === 'YEAR').map((s) => s.label))
  const months = [...new Set(rows.map((r) => r.month))]
  const equiv = (r) => (annual.has(r.member) ? r.price / 12 : r.price)
  const max = Math.max(...rows.map(equiv)) * 1.1
  const x = (i) => PAD.l + (i * (W - PAD.l - PAD.r)) / (months.length - 1)
  const y = (v) => H - PAD.b - (v / max) * (H - PAD.t - PAD.b)
  const members = [...new Set(rows.map((r) => r.member))]
  const monthsOf = (m) => rows.filter((r) => r.member === m)
  return (
    <div className="rd-widget">
      <div className="rd-card-title">Price ladder, strategy {strategy} <span className="rd-foot">monthly equivalent per member, derived</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} className="rd-svg" role="img" aria-label="Price per member over 13 months">
        {[0, 0.5, 1].map((t) => <line key={t} x1={PAD.l} x2={W - PAD.r} y1={y(max * t / 1.1)} y2={y(max * t / 1.1)} className="rd-grid" />)}
        {[0, 0.5, 1].map((t) => <text key={`t${t}`} x={4} y={y(max * t / 1.1) + 4} className="rd-axis rd-mono">${(max * t / 1.1).toFixed(0)}</text>)}
        {members.map((m) => {
          const mine = monthsOf(m)
          const raised = mine[0].cohort === 'raised'
          const d = mine.map((r, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(equiv(r))}`).join(' ')
          return <path key={m} d={d} className={raised ? 'rd-line-amber' : 'rd-line-mint'} fill="none" />
        })}
        {months.map((mo, i) => (i % 3 === 0 ? <text key={mo} x={x(i)} y={H - 8} className="rd-axis rd-mono" textAnchor="middle">{mo.slice(2)}</text> : null))}
      </svg>
      <div className="rd-legend"><span className="rd-pill rd-pill-mint">kept: flat</span><span className="rd-pill rd-pill-amber">raised: steps up from the first new charge</span></div>
    </div>
  )
}
