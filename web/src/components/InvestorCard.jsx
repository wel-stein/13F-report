import { Link } from 'react-router-dom'
import { fmtCompactUSD, fmtSignedUSD } from '../format.js'

export default function InvestorCard({ filer, data }) {
  const buys  = data?.holdings?.filter((h) => h.action === 'new' || h.action === 'add') ?? []
  const sells = [
    ...(data?.holdings?.filter((h) => h.action === 'trim') ?? []),
    ...(data?.exited ?? []),
  ]
  const valueDelta = data?.total_value_usd_prior != null
    ? data.total_value_usd - data.total_value_usd_prior
    : null

  return (
    <Link
      to={`/investor/${filer.cik}`}
      className="group rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-indigo-400 hover:shadow"
    >
      <p className="text-sm font-semibold text-slate-900 group-hover:text-indigo-700">
        {filer.name}
      </p>
      <p className="mt-0.5 font-mono text-xs text-slate-500">CIK {filer.cik}</p>

      <div className="mt-3 flex items-baseline justify-between">
        <span className="text-xl font-semibold tabular-nums text-slate-900">
          {fmtCompactUSD(filer.total_value_usd)}
        </span>
        {valueDelta != null && (
          <span
            className={
              'text-xs tabular-nums ' +
              (valueDelta > 0
                ? 'text-emerald-700'
                : valueDelta < 0
                  ? 'text-rose-700'
                  : 'text-slate-500')
            }
          >
            {fmtSignedUSD(valueDelta)}
          </span>
        )}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
        <Stat label="Holdings" value={(filer.holdings_count ?? 0).toLocaleString()} />
        <Stat label="Buys"  value={buys.length}  tone="emerald" />
        <Stat label="Sells" value={sells.length} tone="rose" />
      </div>
    </Link>
  )
}

function Stat({ label, value, tone = 'slate' }) {
  const cls =
    tone === 'emerald'
      ? 'text-emerald-700'
      : tone === 'rose'
        ? 'text-rose-700'
        : 'text-slate-700'
  return (
    <div className="rounded bg-slate-50 px-2 py-1.5">
      <p className={`text-sm font-semibold ${cls}`}>{value}</p>
      <p className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
    </div>
  )
}
