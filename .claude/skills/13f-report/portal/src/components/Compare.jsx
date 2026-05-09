import { useEffect, useMemo } from 'react'
import { fmtCompactUSD, fmtSignedUSD } from '../format.js'

function key(h) {
  return `${h.cusip}|${h.class ?? ''}|${h.put_call ?? ''}`
}

function combine(dataA, dataB) {
  const m = new Map()
  const ingest = (data, side) => {
    if (!data) return
    for (const h of data.holdings ?? []) {
      const k = key(h)
      const e = m.get(k) ?? {
        issuer: h.issuer, cusip: h.cusip, class: h.class, put_call: h.put_call,
        aShares: 0, aValue: 0, bShares: 0, bValue: 0,
      }
      e[`${side}Shares`] = h.shares
      e[`${side}Value`] = h.value_usd
      m.set(k, e)
    }
  }
  ingest(dataA, 'a')
  ingest(dataB, 'b')
  return [...m.values()].map((e) => {
    const inA = e.aShares > 0
    const inB = e.bShares > 0
    const status = inA && inB ? 'both' : inA ? 'a' : 'b'
    return { ...e, combined: e.aValue + e.bValue, status }
  })
}

function Stat({ label, value, sub, tone = 'slate' }) {
  const toneClass = {
    slate: 'text-slate-900 dark:text-slate-100',
    indigo: 'text-indigo-700 dark:text-indigo-400',
    emerald: 'text-emerald-700 dark:text-emerald-400',
    rose: 'text-rose-700 dark:text-rose-400',
  }[tone]
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`mt-1 text-xl font-semibold sm:text-2xl ${toneClass}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{sub}</p>}
    </div>
  )
}

function Picker({ label, value, onChange, filers, exclude }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 dark:text-slate-400">
      {label}
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      >
        <option value="">— pick a filer —</option>
        {filers
          .filter((f) => !f.error && f.cik !== exclude)
          .map((f) => (
            <option key={f.cik} value={f.cik}>{f.name}</option>
          ))}
      </select>
    </label>
  )
}

const STATUS_STYLE = {
  both: 'bg-indigo-100 text-indigo-800 ring-indigo-600/20 dark:bg-indigo-950/60 dark:text-indigo-300 dark:ring-indigo-400/30',
  a:    'bg-emerald-100 text-emerald-800 ring-emerald-600/20 dark:bg-emerald-950/60 dark:text-emerald-300 dark:ring-emerald-400/30',
  b:    'bg-rose-100 text-rose-800 ring-rose-600/20 dark:bg-rose-950/60 dark:text-rose-300 dark:ring-rose-400/30',
}

export default function Compare({
  summary,
  filerCache,
  fetchFiler,
  a, b,
  onChangeA, onChangeB,
}) {
  const filers = summary?.filers ?? []
  const filerA = useMemo(() => filers.find((f) => f.cik === a) ?? null, [filers, a])
  const filerB = useMemo(() => filers.find((f) => f.cik === b) ?? null, [filers, b])

  // Trigger lazy load for whichever sides are picked.
  useEffect(() => {
    if (filerA) fetchFiler(filerA)
    if (filerB) fetchFiler(filerB)
  }, [filerA, filerB, fetchFiler])

  const dataA = a ? filerCache[a] : null
  const dataB = b ? filerCache[b] : null

  const rows = useMemo(() => {
    if (!dataA && !dataB) return []
    return combine(dataA, dataB).sort((x, y) => y.combined - x.combined)
  }, [dataA, dataB])

  const counts = useMemo(() => {
    const c = { both: 0, a: 0, b: 0 }
    for (const r of rows) c[r.status] += 1
    return c
  }, [rows])

  const totalA = dataA?.total_value_usd ?? 0
  const totalB = dataB?.total_value_usd ?? 0

  const overlapValueA = rows.filter((r) => r.status === 'both').reduce((s, r) => s + r.aValue, 0)
  const overlapValueB = rows.filter((r) => r.status === 'both').reduce((s, r) => s + r.bValue, 0)
  const overlapPctA = totalA ? (overlapValueA / totalA) * 100 : 0
  const overlapPctB = totalB ? (overlapValueB / totalB) * 100 : 0

  const ready = !!(dataA && dataB)
  const loadingA = !!a && !dataA
  const loadingB = !!b && !dataB

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100 sm:text-2xl">Compare filers</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Pick two filers to see overlap, divergent bets, and per-filer weights side by side.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Picker label="Filer A" value={a} onChange={onChangeA} filers={filers} exclude={b} />
        <Picker label="Filer B" value={b} onChange={onChangeB} filers={filers} exclude={a} />
      </div>

      {(loadingA || loadingB) && (
        <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
      )}

      {ready && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Overlap" value={`${counts.both}`} sub={`${rows.length} unique securities`} tone="indigo" />
            <Stat label={`Only ${filerA.name}`} value={`${counts.a}`} sub={fmtCompactUSD(totalA - overlapValueA)} tone="emerald" />
            <Stat label={`Only ${filerB.name}`} value={`${counts.b}`} sub={fmtCompactUSD(totalB - overlapValueB)} tone="rose" />
            <Stat
              label="Overlap weight"
              value={`${overlapPctA.toFixed(0)}% / ${overlapPctB.toFixed(0)}%`}
              sub={`${filerA.name.split(' ')[0]} / ${filerB.name.split(' ')[0]}`}
            />
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
                <thead className="bg-slate-50 dark:bg-slate-800/50">
                  <tr className="text-slate-700 dark:text-slate-300">
                    <th scope="col" className="px-3 py-2 text-left font-semibold">Issuer</th>
                    <th scope="col" className="hidden px-3 py-2 text-right font-semibold sm:table-cell">{filerA.name}</th>
                    <th scope="col" className="hidden px-3 py-2 text-right font-semibold sm:table-cell">{filerB.name}</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Δ A − B</th>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">In</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {rows.length === 0 && (
                    <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500 dark:text-slate-400">No holdings to compare.</td></tr>
                  )}
                  {rows.map((r) => {
                    const diff = r.aValue - r.bValue
                    const tone = diff > 0 ? 'text-emerald-700 dark:text-emerald-400'
                      : diff < 0 ? 'text-rose-700 dark:text-rose-400'
                      : 'text-slate-500 dark:text-slate-400'
                    const inLabel = r.status === 'both' ? 'both'
                      : r.status === 'a' ? filerA.name : filerB.name
                    return (
                      <tr key={key(r)} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="px-3 py-2">
                          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{r.issuer}</p>
                          <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400">{r.cusip}</p>
                        </td>
                        <td className="hidden px-3 py-2 text-right tabular-nums text-slate-900 dark:text-slate-100 sm:table-cell">
                          {r.aValue ? fmtCompactUSD(r.aValue) : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="hidden px-3 py-2 text-right tabular-nums text-slate-900 dark:text-slate-100 sm:table-cell">
                          {r.bValue ? fmtCompactUSD(r.bValue) : <span className="text-slate-400">—</span>}
                        </td>
                        <td className={`px-3 py-2 text-right tabular-nums ${tone}`}>
                          {fmtSignedUSD(diff)}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLE[r.status]}`}>
                            {inLabel}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
