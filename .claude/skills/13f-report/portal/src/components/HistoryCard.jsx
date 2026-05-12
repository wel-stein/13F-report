// Quarterly AUM history panel — SVG sparkline + table.
// Props:
//   history  {quarter, filing_date, total_value_usd, holdings_count, top5_holdings}[]
//            sorted newest first (we reverse to plot newest on the right)

import { fmtCompactUSD, fmtSignedUSD } from '../format.js'

const SPARKLINE_W = 320
const SPARKLINE_H = 56
const PAD_X = 8
const PAD_Y = 6

function Sparkline({ points }) {
  // points: [{x, y}] in SVG space
  if (points.length < 2) return null
  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ')
  return (
    <svg
      viewBox={`0 0 ${SPARKLINE_W} ${SPARKLINE_H}`}
      className="w-full"
      aria-hidden="true"
      style={{ height: SPARKLINE_H }}
    >
      {/* Area fill */}
      <defs>
        <linearGradient id="spark-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6366f1" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#6366f1" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path
        d={`${d} L ${points[points.length - 1].x.toFixed(1)} ${SPARKLINE_H - PAD_Y} L ${points[0].x.toFixed(1)} ${SPARKLINE_H - PAD_Y} Z`}
        fill="url(#spark-grad)"
      />
      {/* Line */}
      <path d={d} fill="none" stroke="#6366f1" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
      {/* Terminal dot */}
      <circle
        cx={points[points.length - 1].x}
        cy={points[points.length - 1].y}
        r="3"
        fill="#6366f1"
      />
    </svg>
  )
}

export default function HistoryCard({ history }) {
  if (!history || history.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Quarterly AUM History</h2>
        </div>
        <p className="px-4 py-5 text-center text-sm text-slate-500 dark:text-slate-400">No historical data available.</p>
      </div>
    )
  }

  // history is newest-first; reverse so index 0 = oldest (left on sparkline).
  const sorted = [...history].reverse()

  // Build sparkline SVG points.
  const values = sorted.map((q) => q.total_value_usd ?? 0)
  const minVal = Math.min(...values)
  const maxVal = Math.max(...values)
  const range = maxVal - minVal || 1
  const n = sorted.length
  const sparkPoints = sorted.map((q, i) => ({
    x: PAD_X + (i / Math.max(n - 1, 1)) * (SPARKLINE_W - PAD_X * 2),
    y: PAD_Y + ((1 - (q.total_value_usd ?? 0 - minVal) / range)) * (SPARKLINE_H - PAD_Y * 2),
  }))

  // Table rows newest-first (match original history order).
  const tableRows = history.map((q, i) => {
    // The "prior" quarter is the next item in the reversed sorted array.
    // In the original (newest-first) array, prev is at index i+1.
    const prev = history[i + 1]
    const delta = prev != null ? (q.total_value_usd ?? 0) - (prev.total_value_usd ?? 0) : null
    return { ...q, delta }
  })

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Quarterly AUM History</h2>
      </div>

      {n >= 2 && (
        <div className="border-b border-slate-100 px-4 pb-2 pt-3 dark:border-slate-800">
          <Sparkline points={sparkPoints} />
          <div className="mt-1 flex justify-between text-[11px] text-slate-400 dark:text-slate-500">
            <span>{sorted[0]?.quarter}</span>
            <span>{sorted[n - 1]?.quarter}</span>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-100 text-sm dark:divide-slate-800">
          <thead className="bg-slate-50 dark:bg-slate-800/50">
            <tr className="text-slate-700 dark:text-slate-300">
              <th scope="col" className="px-4 py-2 text-left font-semibold">Quarter</th>
              <th scope="col" className="px-4 py-2 text-right font-semibold">AUM</th>
              <th scope="col" className="hidden px-4 py-2 text-right font-semibold sm:table-cell">Δ vs prev</th>
              <th scope="col" className="px-4 py-2 text-right font-semibold">Holdings</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
            {tableRows.map((row) => {
              const deltaTone = row.delta == null
                ? 'text-slate-400 dark:text-slate-500'
                : row.delta > 0 ? 'text-emerald-700 dark:text-emerald-400'
                : row.delta < 0 ? 'text-rose-700 dark:text-rose-400'
                : 'text-slate-500 dark:text-slate-400'
              return (
                <tr key={row.quarter} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-2 font-medium text-slate-900 dark:text-slate-100">
                    {row.quarter}
                    {row.filing_date && (
                      <span className="ml-1.5 text-[11px] text-slate-400 dark:text-slate-500">
                        filed {row.filing_date}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-900 dark:text-slate-100">
                    {fmtCompactUSD(row.total_value_usd)}
                  </td>
                  <td className={`hidden px-4 py-2 text-right tabular-nums sm:table-cell ${deltaTone}`}>
                    {row.delta == null ? '—' : fmtSignedUSD(row.delta)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-700 dark:text-slate-300">
                    {row.holdings_count?.toLocaleString() ?? '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
