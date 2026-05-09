import { fmtSignedUSD, ACTION_STYLE } from '../format.js'

function MoveRow({ row }) {
  const cls = ACTION_STYLE[row.action] ?? ACTION_STYLE.hold
  const sign = (row.delta_value_usd ?? 0) > 0 ? 'text-emerald-700 dark:text-emerald-400'
            : (row.delta_value_usd ?? 0) < 0 ? 'text-rose-700 dark:text-rose-400'
            : 'text-slate-500 dark:text-slate-400'
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
            {row.issuer}
          </span>
          <span className={`inline-flex shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${cls}`}>
            {row.action}
          </span>
        </div>
        {row.cusip && (
          <p className="truncate text-[11px] font-mono text-slate-500 dark:text-slate-400">
            {row.cusip}
          </p>
        )}
      </div>
      <div className={`shrink-0 text-right tabular-nums text-sm font-medium ${sign}`}>
        {fmtSignedUSD(row.delta_value_usd ?? 0)}
      </div>
    </li>
  )
}

function Panel({ title, rows, emptyLabel }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-baseline justify-between border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
        <span className="text-xs text-slate-500 dark:text-slate-400">by Δ value</span>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">{emptyLabel}</p>
      ) : (
        <ul className="divide-y divide-slate-100 px-4 dark:divide-slate-800">
          {rows.map((r, i) => <MoveRow key={`${r.cusip}-${r.action}-${i}`} row={r} />)}
        </ul>
      )}
    </div>
  )
}

export default function TopMoves({ buys = [], sells = [], limit = 5 }) {
  const buysTop = buys.slice(0, limit)
  const sellsTop = sells.slice(0, limit)
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Panel title={`Top ${buysTop.length || ''} Buys`.trim()} rows={buysTop} emptyLabel="No new or added positions." />
      <Panel title={`Top ${sellsTop.length || ''} Sells`.trim()} rows={sellsTop} emptyLabel="No trims or exits." />
    </div>
  )
}

