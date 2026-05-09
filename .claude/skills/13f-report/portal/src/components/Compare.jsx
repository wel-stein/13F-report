import { useEffect, useMemo, useState } from 'react'
import { fmtCompactUSD, fmtSignedUSD } from '../format.js'

function key(h) {
  return `${h.cusip}|${h.class ?? ''}|${h.put_call ?? ''}`
}

function combine(dataA, dataB) {
  const m = new Map()
  const get = (k, h) => {
    const e = m.get(k)
    if (e) return e
    const fresh = {
      issuer: h.issuer, cusip: h.cusip, class: h.class, put_call: h.put_call,
      aShares: 0, aValue: 0, aExited: false,
      bShares: 0, bValue: 0, bExited: false,
    }
    m.set(k, fresh)
    return fresh
  }
  const ingestHoldings = (data, side) => {
    if (!data) return
    for (const h of data.holdings ?? []) {
      const e = get(key(h), h)
      e[`${side}Shares`] = h.shares
      e[`${side}Value`] = h.value_usd
    }
  }
  const ingestExited = (data, side) => {
    if (!data) return
    for (const h of data.exited ?? []) {
      const e = get(key(h), h)
      e[`${side}Exited`] = true
    }
  }
  ingestHoldings(dataA, 'a')
  ingestHoldings(dataB, 'b')
  ingestExited(dataA, 'a')
  ingestExited(dataB, 'b')
  return [...m.values()]
    .filter((e) => e.aShares > 0 || e.bShares > 0)
    .map((e) => {
      const inA = e.aShares > 0
      const inB = e.bShares > 0
      const status = inA && inB ? 'both' : inA ? 'a' : 'b'
      return { ...e, combined: e.aValue + e.bValue, diff: e.aValue - e.bValue, status }
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
      <p className="truncate text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400" title={label}>{label}</p>
      <p className={`mt-1 break-words text-xl font-semibold sm:text-2xl ${toneClass}`}>{value}</p>
      {sub && <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400" title={sub}>{sub}</p>}
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
const EXITED_STYLE = 'bg-amber-100 text-amber-800 ring-amber-600/20 dark:bg-amber-950/60 dark:text-amber-300 dark:ring-amber-400/30'

const COLUMNS = [
  { key: 'issuer',   label: 'Issuer',   align: 'left'  },
  { key: 'aValue',   label: 'A',        align: 'right', sortKey: 'aValue' },
  { key: 'bValue',   label: 'B',        align: 'right', sortKey: 'bValue' },
  { key: 'combined', label: 'Combined', align: 'right', sortKey: 'combined', responsive: 'hidden md:table-cell' },
  { key: 'diff',     label: 'Δ A − B',  align: 'right', sortKey: 'diff' },
  { key: 'status',   label: 'In',       align: 'left',  sortKey: 'status' },
]

function shortName(name) {
  if (!name) return ''
  return name.length > 16 ? `${name.slice(0, 14)}…` : name
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
    if (filerA && !filerA.error) fetchFiler(filerA)
    if (filerB && !filerB.error) fetchFiler(filerB)
  }, [filerA, filerB, fetchFiler])

  const sameFiler = !!a && a === b
  const dataA = a ? filerCache[a] : null
  const dataB = b ? filerCache[b] : null
  const errA = filerA?.error ?? null
  const errB = filerB?.error ?? null

  const [sortKey, setSortKey] = useState('combined')
  const [sortDir, setSortDir] = useState('desc')

  const baseRows = useMemo(() => {
    if (!dataA && !dataB) return []
    return combine(dataA, dataB)
  }, [dataA, dataB])

  const rows = useMemo(() => {
    const get = (r) => r[sortKey]
    return [...baseRows].sort((x, y) => {
      const xv = get(x), yv = get(y)
      if (typeof xv === 'string') return sortDir === 'asc' ? xv.localeCompare(yv) : yv.localeCompare(xv)
      return sortDir === 'asc' ? xv - yv : yv - xv
    })
  }, [baseRows, sortKey, sortDir])

  const counts = useMemo(() => {
    const c = { both: 0, a: 0, b: 0 }
    for (const r of baseRows) c[r.status] += 1
    return c
  }, [baseRows])

  const totalA = dataA?.total_value_usd ?? 0
  const totalB = dataB?.total_value_usd ?? 0

  const overlapValueA = baseRows.filter((r) => r.status === 'both').reduce((s, r) => s + r.aValue, 0)
  const overlapValueB = baseRows.filter((r) => r.status === 'both').reduce((s, r) => s + r.bValue, 0)
  const overlapPctA = totalA ? (overlapValueA / totalA) * 100 : 0
  const overlapPctB = totalB ? (overlapValueB / totalB) * 100 : 0

  const ready = !sameFiler && !!(dataA && dataB) && !errA && !errB
  const loadingA = !!a && !sameFiler && !errA && !dataA
  const loadingB = !!b && !sameFiler && !errB && !dataB

  function setSort(nextKey) {
    if (sortKey === nextKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(nextKey); setSortDir('desc') }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100 sm:text-2xl">Compare filers</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Pick two filers to see overlap, divergent bets, and per-filer weights side by side.
          Includes prior-quarter exits as a secondary badge.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Picker label="Filer A" value={a} onChange={onChangeA} filers={filers} exclude={b} />
        <Picker label="Filer B" value={b} onChange={onChangeB} filers={filers} exclude={a} />
      </div>

      {sameFiler && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          Pick two different filers to compare.
        </div>
      )}

      {(errA || errB) && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
          {errA && <p>{filerA.name}: {errA}</p>}
          {errB && <p>{filerB.name}: {errB}</p>}
        </div>
      )}

      {(loadingA || loadingB) && (
        <p className="text-sm text-slate-500 dark:text-slate-400">Loading filer data…</p>
      )}

      {ready && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Overlap" value={`${counts.both}`} sub={`${baseRows.length} unique securities`} tone="indigo" />
            <Stat label={`Only A — ${shortName(filerA.name)}`} value={`${counts.a}`} sub={fmtCompactUSD(totalA - overlapValueA)} tone="emerald" />
            <Stat label={`Only B — ${shortName(filerB.name)}`} value={`${counts.b}`} sub={fmtCompactUSD(totalB - overlapValueB)} tone="rose" />
            <Stat
              label="Overlap weight"
              value={`${overlapPctA.toFixed(0)}% / ${overlapPctB.toFixed(0)}%`}
              sub={`${shortName(filerA.name)} / ${shortName(filerB.name)}`}
            />
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
                <thead className="bg-slate-50 dark:bg-slate-800/50">
                  <tr>
                    {COLUMNS.map((c) => {
                      const isSorted = sortKey === c.sortKey
                      const ariaSort = isSorted ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
                      const headerLabel = c.key === 'aValue' ? shortName(filerA.name)
                        : c.key === 'bValue' ? shortName(filerB.name)
                        : c.label
                      return (
                        <th
                          key={c.key}
                          scope="col"
                          aria-sort={ariaSort}
                          className={`font-semibold text-slate-700 dark:text-slate-300 ${c.responsive ?? ''}`}
                        >
                          <button
                            type="button"
                            onClick={() => c.sortKey && setSort(c.sortKey)}
                            disabled={!c.sortKey}
                            className={
                              `flex w-full items-center gap-1 px-3 py-2 select-none ` +
                              `focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ` +
                              (c.align === 'right' ? 'justify-end' : 'justify-start')
                            }
                          >
                            <span>{headerLabel}</span>
                            <span className={'text-slate-400 dark:text-slate-500 ' + (isSorted ? '' : 'invisible')}>
                              {sortDir === 'asc' ? '▲' : '▼'}
                            </span>
                          </button>
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {rows.length === 0 && (
                    <tr><td colSpan={COLUMNS.length} className="px-3 py-6 text-center text-slate-500 dark:text-slate-400">No holdings to compare.</td></tr>
                  )}
                  {rows.map((r) => {
                    const tone = r.diff > 0 ? 'text-emerald-700 dark:text-emerald-400'
                      : r.diff < 0 ? 'text-rose-700 dark:text-rose-400'
                      : 'text-slate-500 dark:text-slate-400'
                    const inLabel = r.status === 'both' ? 'both'
                      : r.status === 'a' ? shortName(filerA.name) : shortName(filerB.name)
                    return (
                      <tr key={key(r)} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="px-3 py-2">
                          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{r.issuer}</p>
                          <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400">{r.cusip}</p>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-900 dark:text-slate-100">
                          {r.aValue ? fmtCompactUSD(r.aValue) : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-900 dark:text-slate-100">
                          {r.bValue ? fmtCompactUSD(r.bValue) : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="hidden px-3 py-2 text-right tabular-nums text-slate-900 dark:text-slate-100 md:table-cell">
                          {fmtCompactUSD(r.combined)}
                        </td>
                        <td className={`px-3 py-2 text-right tabular-nums ${tone}`}>
                          {fmtSignedUSD(r.diff)}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLE[r.status]}`}>
                            {inLabel}
                          </span>
                          {(r.status === 'a' && r.bExited) || (r.status === 'b' && r.aExited) ? (
                            <span className={`ml-1 inline-flex rounded px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${EXITED_STYLE}`}>
                              {r.aExited ? `${shortName(filerA.name)} sold` : `${shortName(filerB.name)} sold`}
                            </span>
                          ) : null}
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
