import { useMemo, useState } from 'react'
import {
  ACTION_STYLE,
  fmtCompactUSD,
  fmtPct,
  fmtShares,
  fmtSignedShares,
  fmtSignedUSD,
} from '../format.js'

const COLUMNS = [
  { key: 'issuer',          label: 'Issuer',              align: 'left'  },
  { key: 'cusip',           label: 'CUSIP',               align: 'left',  className: 'font-mono text-xs',
    responsive: 'hidden sm:table-cell' },
  { key: 'shares_prior',    label: 'Shares (prior)',      align: 'right', fmt: fmtShares,
    responsive: 'hidden md:table-cell' },
  { key: 'shares',          label: 'Shares (current)',    align: 'right', fmt: fmtShares },
  { key: 'delta_shares',    label: 'Δ Shares',            align: 'right', fmt: fmtSignedShares,
    cellTone: (r) => (r.delta_shares > 0 ? 'text-emerald-700' : r.delta_shares < 0 ? 'text-rose-700' : 'text-slate-500') },
  { key: 'delta_pct',       label: 'Δ %',                 align: 'right',
    responsive: 'hidden sm:table-cell',
    accessor: (r) => (r.shares_prior ? (r.shares - r.shares_prior) / r.shares_prior : (r.shares ? Infinity : 0)),
    fmt: (_, r) => fmtPct(r.shares, r.shares_prior) },
  { key: 'value_usd',       label: 'Value (current)',     align: 'right', fmt: fmtCompactUSD },
  { key: 'delta_value_usd', label: 'Δ Value',             align: 'right', fmt: fmtSignedUSD,
    cellTone: (r) => (r.delta_value_usd > 0 ? 'text-emerald-700' : r.delta_value_usd < 0 ? 'text-rose-700' : 'text-slate-500') },
  { key: 'action',          label: 'Action',              align: 'left' },
]

const ACTION_FILTERS = [
  { id: 'all',  label: 'All',     match: () => true },
  { id: 'new',  label: 'New',     match: (h) => h.action === 'new' },
  { id: 'add',  label: 'Added',   match: (h) => h.action === 'add' },
  { id: 'trim', label: 'Trimmed', match: (h) => h.action === 'trim' },
  { id: 'exit', label: 'Exited',  match: (h) => h.action === 'exit' },
  { id: 'hold', label: 'Hold',    match: (h) => h.action === 'hold' },
]

export default function HoldingsTable({ holdings = [], exited = [] }) {
  const all = useMemo(() => [...holdings, ...exited], [holdings, exited])
  const [filter, setFilter] = useState('all')
  const [sortKey, setSortKey] = useState('value_usd')
  const [sortDir, setSortDir] = useState('desc')
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const f = ACTION_FILTERS.find((x) => x.id === filter) ?? ACTION_FILTERS[0]
    const q = query.trim().toLowerCase()
    let rows = all.filter(f.match)
    if (q) rows = rows.filter((r) =>
      r.issuer.toLowerCase().includes(q) || r.cusip.toLowerCase().includes(q))
    const col = COLUMNS.find((c) => c.key === sortKey)
    const get = col?.accessor ?? ((r) => r[sortKey])
    rows = [...rows].sort((a, b) => {
      const av = get(a), bv = get(b)
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      return sortDir === 'asc' ? (av - bv) : (bv - av)
    })
    return rows
  }, [all, filter, query, sortKey, sortDir])

  const counts = useMemo(() => {
    const c = { all: all.length }
    for (const f of ACTION_FILTERS.slice(1)) c[f.id] = all.filter(f.match).length
    return c
  }, [all])

  function setSort(key) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('desc') }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-2 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center">
        <div className="flex flex-wrap gap-1">
          {ACTION_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={
                'rounded px-3 py-1.5 text-xs font-medium ring-1 ring-inset transition ' +
                (filter === f.id
                  ? 'bg-indigo-600 text-white ring-indigo-600'
                  : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50')
              }
            >
              {f.label} <span className="opacity-70">({counts[f.id] ?? 0})</span>
            </button>
          ))}
        </div>
        <div className="sm:ml-auto">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter issuer or CUSIP…"
            className="w-full rounded border border-slate-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:w-64"
          />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={
                    `px-3 py-2 font-semibold text-slate-700 select-none cursor-pointer ` +
                    (c.align === 'right' ? 'text-right ' : 'text-left ') +
                    (c.responsive ?? '')
                  }
                  onClick={() => setSort(c.key)}
                >
                  {c.label}
                  {sortKey === c.key && (
                    <span className="ml-1 text-slate-400">{sortDir === 'asc' ? '▲' : '▼'}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {filtered.length === 0 && (
              <tr><td colSpan={COLUMNS.length} className="px-3 py-6 text-center text-slate-500">No rows.</td></tr>
            )}
            {filtered.map((row, i) => (
              <tr key={`${row.cusip}-${row.action}-${i}`} className="hover:bg-slate-50">
                {COLUMNS.map((c) => {
                  if (c.key === 'action') {
                    const cls = ACTION_STYLE[row.action] ?? ACTION_STYLE.hold
                    return (
                      <td key={c.key} className={`px-3 py-2 ${c.responsive ?? ''}`}>
                        <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}>
                          {row.action}
                        </span>
                      </td>
                    )
                  }
                  const get = c.accessor ?? ((r) => r[c.key])
                  const raw = get(row)
                  const display = c.fmt ? c.fmt(raw, row) : raw
                  const tone = c.cellTone ? c.cellTone(row) : ''
                  return (
                    <td
                      key={c.key}
                      className={
                        `px-3 py-2 ${c.align === 'right' ? 'text-right tabular-nums' : ''} ` +
                        `${c.className ?? ''} ${tone} ${c.responsive ?? ''}`
                      }
                    >
                      {display}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
