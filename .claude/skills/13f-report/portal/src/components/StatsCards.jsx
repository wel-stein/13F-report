import { fmtCompactUSD, fmtSignedUSD } from '../format.js'

function Card({ label, value, sub, tone = 'slate' }) {
  const toneClass = {
    slate:   'text-slate-900',
    emerald: 'text-emerald-700',
    rose:    'text-rose-700',
    indigo:  'text-indigo-700',
  }[tone]
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  )
}

export default function StatsCards({ filer }) {
  const holdings = filer.holdings || []
  const exited = filer.exited || []
  const newCount  = holdings.filter((h) => h.action === 'new').length
  const addCount  = holdings.filter((h) => h.action === 'add').length
  const trimCount = holdings.filter((h) => h.action === 'trim').length
  const holdCount = holdings.filter((h) => h.action === 'hold').length

  const valueDelta = filer.total_value_usd_prior != null
    ? filer.total_value_usd - filer.total_value_usd_prior
    : null

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Card
        label="Total Portfolio Value"
        value={fmtCompactUSD(filer.total_value_usd)}
        sub={valueDelta != null ? `${fmtSignedUSD(valueDelta)} vs prior` : undefined}
        tone="indigo"
      />
      <Card
        label="Holdings"
        value={(filer.holdings_count ?? 0).toLocaleString()}
        sub={`${holdCount} unchanged`}
      />
      <Card
        label="New + Added"
        value={`${newCount + addCount}`}
        sub={`${newCount} new · ${addCount} added`}
        tone="emerald"
      />
      <Card
        label="Trimmed + Exited"
        value={`${trimCount + exited.length}`}
        sub={`${trimCount} trimmed · ${exited.length} exited`}
        tone="rose"
      />
    </div>
  )
}
