import { Link } from 'react-router-dom'
import { fmtCompactUSD, fmtSignedShares, fmtSignedUSD } from '../format.js'

/**
 * Render an aggregated buy/sell list (cross-investor). Each row shows the
 * net delta and the contributing investors as small chips.
 */
export default function MoverList({ rows, kind = 'buy', limit = 10 }) {
  const top = rows.slice(0, limit)
  const tone =
    kind === 'buy'
      ? { value: 'text-emerald-700', bar: 'bg-emerald-500' }
      : { value: 'text-rose-700',    bar: 'bg-rose-500' }
  const max = Math.max(1, ...top.map((r) => Math.abs(r.net_delta_value_usd)))

  return (
    <ol className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
      {top.length === 0 && (
        <li className="px-4 py-6 text-sm text-slate-500">No activity.</li>
      )}
      {top.map((r, i) => {
        const pct = (Math.abs(r.net_delta_value_usd) / max) * 100
        const movers = kind === 'buy' ? r.buyers : r.sellers
        return (
          <li key={`${r.cusip}-${r.put_call}`} className="px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900">
                  <span className="mr-2 text-xs text-slate-400">{i + 1}.</span>
                  {r.issuer}
                  {r.put_call && (
                    <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs uppercase text-slate-600">
                      {r.put_call}
                    </span>
                  )}
                </p>
                <p className="mt-0.5 font-mono text-xs text-slate-500">
                  CUSIP {r.cusip} · {r.class}
                </p>
              </div>
              <div className="text-right">
                <p className={`text-sm font-semibold tabular-nums ${tone.value}`}>
                  {fmtSignedUSD(r.net_delta_value_usd)}
                </p>
                <p className="text-xs text-slate-500 tabular-nums">
                  {fmtSignedShares(r.net_delta_shares)} sh
                </p>
              </div>
            </div>
            <div className="mt-2 h-1.5 w-full rounded bg-slate-100">
              <div className={`h-1.5 rounded ${tone.bar}`} style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {movers.slice(0, 6).map((m) => (
                <Link
                  key={m.cik}
                  to={`/investor/${m.cik}`}
                  className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-200"
                  title={`${m.name}: ${fmtSignedUSD(m.delta_value_usd)} (${m.action})`}
                >
                  {m.name} <span className="text-slate-500">{fmtCompactUSD(Math.abs(m.delta_value_usd))}</span>
                </Link>
              ))}
              {movers.length > 6 && (
                <span className="rounded px-2 py-0.5 text-xs text-slate-500">
                  +{movers.length - 6} more
                </span>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

