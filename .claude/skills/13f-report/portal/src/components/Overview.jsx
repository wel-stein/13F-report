import { useMemo } from 'react'
import { ACTION_STYLE, fmtCompactUSD, fmtSignedUSD } from '../format.js'

function aggregateMoves(filerData) {
  // Pull from each filer's full holdings + exited arrays so we don't miss
  // moves that happen to fall outside the per-filer top_buys/top_sells cuts.
  // Key by CUSIP|class|put_call so options/common stay separate.
  const acc = new Map()
  const credit = (row, sourceName) => {
    if (!row?.cusip) return
    if (!row.delta_value_usd) return
    const key = `${row.cusip}|${row.class ?? ''}|${row.put_call ?? ''}`
    const e = acc.get(key) ?? {
      issuer: row.issuer,
      cusip: row.cusip,
      class: row.class,
      put_call: row.put_call,
      delta_value_usd: 0,
      filers: new Set(),
      actions: new Set(),
    }
    e.delta_value_usd += row.delta_value_usd
    e.filers.add(sourceName)
    e.actions.add(row.action)
    acc.set(key, e)
  }
  for (const { name, data } of filerData) {
    if (!data) continue
    for (const r of data.holdings ?? []) credit(r, name)
    for (const r of data.exited ?? []) credit(r, name)
  }
  return [...acc.values()].map((e) => ({
    ...e,
    filers: [...e.filers],
    actions: [...e.actions],
  }))
}

function ConsensusList({ title, rows, tone, emptyLabel = 'No data yet.' }) {
  const ringClass = tone === 'emerald'
    ? 'ring-emerald-300 dark:ring-emerald-800'
    : tone === 'rose' ? 'ring-rose-300 dark:ring-rose-800'
    : 'ring-slate-300 dark:ring-slate-700'
  const valueClass = tone === 'emerald'
    ? 'text-emerald-700 dark:text-emerald-400'
    : tone === 'rose' ? 'text-rose-700 dark:text-rose-400'
    : 'text-slate-900 dark:text-slate-100'
  return (
    <div className={`rounded-lg border border-slate-200 bg-white shadow-sm ring-1 ring-inset ${ringClass} dark:border-slate-800 dark:bg-slate-900`}>
      <div className="flex items-baseline justify-between border-b border-slate-200 px-4 py-2 dark:border-slate-800">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
        <span className="text-xs text-slate-500 dark:text-slate-400">across all filers</span>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-5 text-center text-sm text-slate-500 dark:text-slate-400">{emptyLabel}</p>
      ) : (
        <ol className="divide-y divide-slate-100 px-4 dark:divide-slate-800">
          {rows.map((r, i) => (
            <li key={r.cusip ?? i} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                  <span className="mr-1 text-slate-400 tabular-nums">{i + 1}.</span>
                  {r.issuer}
                </p>
                <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                  {r.filers.length} {r.filers.length === 1 ? 'filer' : 'filers'} · {r.filers.slice(0, 3).join(' · ')}
                  {r.filers.length > 3 ? ` +${r.filers.length - 3}` : ''}
                </p>
              </div>
              <div className={`shrink-0 text-right tabular-nums text-sm font-medium ${valueClass}`}>
                {fmtSignedUSD(r.delta_value_usd)}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function StatCard({ label, value, sub, tone = 'slate' }) {
  const toneClass = {
    slate: 'text-slate-900 dark:text-slate-100',
    indigo: 'text-indigo-700 dark:text-indigo-400',
    emerald: 'text-emerald-700 dark:text-emerald-400',
    rose: 'text-rose-700 dark:text-rose-400',
  }[tone]
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:px-4">
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400 sm:text-xs">{label}</p>
      <p className={`mt-1 break-words text-xl font-semibold sm:text-2xl ${toneClass}`}>{value}</p>
      {sub && <p className="mt-0.5 break-words text-[11px] text-slate-500 dark:text-slate-400 sm:text-xs">{sub}</p>}
    </div>
  )
}

function ConvictionRankings({ rankings }) {
  const rows = rankings?.slice(0, 15) ?? []
  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Conviction Rankings</h2>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-5 text-center text-sm text-slate-500 dark:text-slate-400">Loading…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm dark:divide-slate-800">
            <thead className="bg-slate-50 dark:bg-slate-800/50">
              <tr className="text-slate-700 dark:text-slate-300">
                <th scope="col" className="px-3 py-2 text-left font-semibold">#</th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">Issuer</th>
                <th scope="col" className="hidden px-3 py-2 text-left font-semibold sm:table-cell">Sector</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Holders</th>
                <th scope="col" className="hidden px-3 py-2 text-right font-semibold md:table-cell">Conviction %</th>
                <th scope="col" className="hidden px-3 py-2 text-right font-semibold lg:table-cell">Weighted Score</th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">Net Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
              {rows.map((r, i) => {
                const actionCls = ACTION_STYLE[r.net_action] ?? ACTION_STYLE.hold
                return (
                  <tr key={r.cusip ?? i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-3 py-2 tabular-nums text-slate-400 dark:text-slate-500">{i + 1}</td>
                    <td className="px-3 py-2">
                      <p className="font-medium text-slate-900 dark:text-slate-100">{r.issuer}</p>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500 font-mono">{r.cusip}</p>
                    </td>
                    <td className="hidden px-3 py-2 text-slate-600 dark:text-slate-400 sm:table-cell">{r.sector ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-900 dark:text-slate-100">{r.holder_count}</td>
                    <td className="hidden px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-300 md:table-cell">
                      {r.conviction_score != null ? `${(r.conviction_score * 100).toFixed(1)}%` : '—'}
                    </td>
                    <td className="hidden px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-300 lg:table-cell">
                      {r.weighted_score != null ? r.weighted_score.toFixed(2) : '—'}
                    </td>
                    <td className="px-3 py-2">
                      {r.net_action ? (
                        <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${actionCls}`}>
                          {r.net_action}
                        </span>
                      ) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function Overview({ summary, filerData, onSelect }) {
  const filers = summary?.filers ?? []
  const ok = filers.filter((f) => !f.error)
  const errored = filers.filter((f) => f.error)

  const totalAum = ok.reduce((s, f) => s + (f.total_value_usd ?? 0), 0)
  const totalAumPrior = ok.reduce((s, f) => s + (f.total_value_usd_prior ?? 0), 0)
  const aumDelta = totalAumPrior ? totalAum - totalAumPrior : null

  const moves = useMemo(() => aggregateMoves(filerData), [filerData])
  const topBuys = useMemo(
    () => [...moves].filter((m) => m.delta_value_usd > 0).sort((a, b) => b.delta_value_usd - a.delta_value_usd).slice(0, 10),
    [moves],
  )
  const topSells = useMemo(
    () => [...moves].filter((m) => m.delta_value_usd < 0).sort((a, b) => a.delta_value_usd - b.delta_value_usd).slice(0, 10),
    [moves],
  )

  const fullyLoaded = ok.every((f) => filerData.find((d) => d.cik === f.cik && d.data))

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100 sm:text-2xl">Overview</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Aggregated across {ok.length} filer{ok.length === 1 ? '' : 's'}
          {errored.length > 0 && ` (${errored.length} with errors)`}
          {summary?.generated_at && ` · generated ${summary.generated_at}`}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatCard
          label="Combined AUM"
          value={fmtCompactUSD(totalAum)}
          sub={aumDelta != null ? `${fmtSignedUSD(aumDelta)} vs prior` : undefined}
          tone="indigo"
        />
        <StatCard
          label="Filers"
          value={`${ok.length}`}
          sub={errored.length > 0 ? `${errored.length} errored` : 'all loaded ok'}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <ConsensusList
          title="Top 10 consensus buys"
          rows={topBuys}
          tone="emerald"
          emptyLabel={fullyLoaded ? 'No net buys reported.' : 'Loading…'}
        />
        <ConsensusList
          title="Top 10 consensus sells"
          rows={topSells}
          tone="rose"
          emptyLabel={fullyLoaded ? 'No net sells reported.' : 'Loading…'}
        />
      </div>

      {!fullyLoaded && (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Loading filer data… {filerData.filter((d) => d.data).length}/{ok.length}
        </p>
      )}

      <ConvictionRankings rankings={summary?.conviction_rankings} />

      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">Per-filer summary</h2>
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
            <thead className="bg-slate-50 dark:bg-slate-800/50">
              <tr className="text-slate-700 dark:text-slate-300">
                <th scope="col" className="px-3 py-2 text-left font-semibold">Filer</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Holdings</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Value</th>
                <th scope="col" className="hidden px-3 py-2 text-right font-semibold sm:table-cell">Δ vs prior</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filers.map((f) => {
                const delta = f.total_value_usd_prior != null
                  ? (f.total_value_usd ?? 0) - f.total_value_usd_prior
                  : null
                const tone = delta == null ? 'text-slate-500 dark:text-slate-400'
                  : delta > 0 ? 'text-emerald-700 dark:text-emerald-400'
                  : delta < 0 ? 'text-rose-700 dark:text-rose-400'
                  : 'text-slate-500 dark:text-slate-400'
                return (
                  <tr key={f.cik} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => onSelect(f.cik)}
                        className="text-left text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400"
                      >
                        {f.name}
                      </button>
                      {f.error && (
                        <p className="mt-0.5 text-[11px] text-rose-600 dark:text-rose-400">{f.error}</p>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-900 dark:text-slate-100">
                      {f.holdings_count?.toLocaleString() ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-900 dark:text-slate-100">
                      {fmtCompactUSD(f.total_value_usd)}
                    </td>
                    <td className={`hidden px-3 py-2 text-right tabular-nums sm:table-cell ${tone}`}>
                      {delta == null ? '—' : fmtSignedUSD(delta)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
