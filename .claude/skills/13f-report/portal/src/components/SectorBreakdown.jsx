// Sector allocation panel — renders horizontal bars for each sector.
// Props:
//   breakdown  {sector, value_usd, count, pct_of_portfolio}[]

const SECTOR_COLORS = {
  'Technology':             'bg-indigo-500 dark:bg-indigo-400',
  'Healthcare':             'bg-emerald-500 dark:bg-emerald-400',
  'Financials':             'bg-sky-500 dark:bg-sky-400',
  'Consumer Discretionary': 'bg-orange-500 dark:bg-orange-400',
  'Industrials':            'bg-amber-500 dark:bg-amber-400',
  'Communication Services': 'bg-violet-500 dark:bg-violet-400',
  'Consumer Staples':       'bg-teal-500 dark:bg-teal-400',
  'Energy':                 'bg-rose-500 dark:bg-rose-400',
  'Real Estate':            'bg-pink-500 dark:bg-pink-400',
  'Materials':              'bg-lime-500 dark:bg-lime-400',
  'Utilities':              'bg-cyan-500 dark:bg-cyan-400',
}
const DOT_FALLBACK = 'bg-slate-400 dark:bg-slate-500'

export default function SectorBreakdown({ breakdown }) {
  if (!breakdown || breakdown.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Sector Allocation</h2>
        </div>
        <p className="px-4 py-5 text-center text-sm text-slate-500 dark:text-slate-400">No sector data available.</p>
      </div>
    )
  }

  // Find the max pct to scale bars relative to the largest sector.
  const maxPct = Math.max(...breakdown.map((s) => s.pct_of_portfolio ?? 0), 1)

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Sector Allocation</h2>
      </div>
      <ul className="divide-y divide-slate-100 px-4 dark:divide-slate-800">
        {breakdown.map((s) => {
          const pct = s.pct_of_portfolio ?? 0
          const barWidth = maxPct > 0 ? (pct / maxPct) * 100 : 0
          const dotCls = SECTOR_COLORS[s.sector] ?? DOT_FALLBACK
          const barCls = SECTOR_COLORS[s.sector] ?? DOT_FALLBACK
          return (
            <li key={s.sector} className="flex items-center gap-3 py-2">
              {/* Dot + label */}
              <div className="flex w-44 shrink-0 items-center gap-2 sm:w-52">
                <span
                  className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${dotCls}`}
                  aria-hidden="true"
                />
                <span className="truncate text-xs font-medium text-slate-800 dark:text-slate-200">
                  {s.sector}
                </span>
                <span className="ml-1 shrink-0 text-[11px] text-slate-400 dark:text-slate-500">
                  {s.count}
                </span>
              </div>

              {/* Bar track */}
              <div className="flex-1">
                <div className="h-2 w-full overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                  <div
                    className={`h-full rounded ${barCls}`}
                    style={{ width: `${barWidth}%` }}
                    aria-label={`${pct.toFixed(1)}%`}
                  />
                </div>
              </div>

              {/* Pct label */}
              <span className="w-10 shrink-0 text-right tabular-nums text-xs text-slate-600 dark:text-slate-400">
                {pct.toFixed(1)}%
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
