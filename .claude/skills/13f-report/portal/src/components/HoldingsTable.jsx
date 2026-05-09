import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ACTION_STYLE,
  fmtCompactUSD,
  fmtPct,
  fmtShares,
  fmtSignedShares,
  fmtSignedUSD,
} from '../format.js'
import SharesSparkline from './SharesSparkline.jsx'

const COLUMNS = [
  { key: 'issuer',          label: 'Issuer',              align: 'left'  },
  { key: 'cusip',           label: 'CUSIP',               align: 'left',  className: 'font-mono text-xs',
    responsive: 'hidden sm:table-cell',
    title: 'Committee on Uniform Securities Identification Procedures number' },
  { key: 'shares_prior',    label: 'Shares (prior)',      align: 'right', fmt: fmtShares,
    responsive: 'hidden md:table-cell' },
  { key: 'shares',          label: 'Shares (current)',    align: 'right', fmt: fmtShares },
  { key: 'delta_shares',    label: 'Δ Shares',            align: 'right', fmt: fmtSignedShares,
    cellTone: (r) => (r.delta_shares > 0 ? 'text-emerald-700 dark:text-emerald-400' : r.delta_shares < 0 ? 'text-rose-700 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400') },
  { key: 'delta_pct',       label: 'Δ %',                 align: 'right',
    responsive: 'hidden sm:table-cell',
    accessor: (r) => (r.shares_prior ? (r.shares - r.shares_prior) / r.shares_prior : (r.shares ? Infinity : 0)),
    fmt: (_, r) => fmtPct(r.shares, r.shares_prior),
    cellTone: (r) => {
      const d = r.shares - (r.shares_prior ?? 0)
      return d > 0 ? 'text-emerald-700 dark:text-emerald-400'
        : d < 0 ? 'text-rose-700 dark:text-rose-400'
        : 'text-slate-500 dark:text-slate-400'
    } },
  { key: 'trend',           label: 'Trend',               align: 'center',
    responsive: 'hidden md:table-cell' },
  { key: 'value_usd',       label: 'Value (current)',     align: 'right', fmt: fmtCompactUSD },
  { key: 'delta_value_usd', label: 'Δ Value',             align: 'right', fmt: fmtSignedUSD,
    cellTone: (r) => (r.delta_value_usd > 0 ? 'text-emerald-700 dark:text-emerald-400' : r.delta_value_usd < 0 ? 'text-rose-700 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400') },
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

const CSV_FIELDS = [
  'issuer', 'cusip', 'class', 'put_call',
  'shares_prior', 'shares', 'delta_shares',
  'value_usd_prior', 'value_usd', 'delta_value_usd',
  'action',
]

function csvEscape(v) {
  if (v == null) return ''
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function rowsToCsv(rows) {
  const header = CSV_FIELDS.join(',')
  const body = rows.map((r) => CSV_FIELDS.map((f) => csvEscape(r[f])).join(',')).join('\n')
  return `${header}\n${body}\n`
}

function downloadCsv(rows, filename) {
  const blob = new Blob([rowsToCsv(rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function HoldingsTable({
  holdings = [],
  exited = [],
  filter = 'all',
  sortKey = 'value_usd',
  sortDir = 'desc',
  query = '',
  onChange,
  csvBaseName = 'holdings',
  pageSize = 100,
  totalValue = 0,
}) {
  const all = useMemo(() => [...holdings, ...exited], [holdings, exited])

  const onChangeRef = useRef(onChange)
  useEffect(() => { onChangeRef.current = onChange }, [onChange])
  const emit = (patch) => {
    const next = { filter, sortKey, sortDir, query, ...patch }
    onChangeRef.current?.(next)
  }

  // Search input is uncontrolled-ish: keep a local snapshot for instant
  // typing, debounce-propagate to the parent (which writes the URL hash)
  // so we don't pump replaceState on every keystroke.
  const [localQuery, setLocalQuery] = useState(query)
  useEffect(() => { setLocalQuery(query) }, [query])
  useEffect(() => {
    if (localQuery === query) return
    const t = setTimeout(() => emit({ query: localQuery }), 200)
    return () => clearTimeout(t)
    // emit captures filter/sort/query as closure; only the localQuery
    // identity should drive the debounce timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localQuery])

  const [page, setPage] = useState(0)
  // Reset to page 0 whenever the underlying data, filter, sort, or query
  // change so we don't land on a now-empty page.
  useEffect(() => { setPage(0) }, [holdings, exited, filter, sortKey, sortDir, query])

  // Scroll the table's thead back to the top of the viewport on page change
  // so users land at row 1 of the new page instead of staring at the
  // (now-empty) footer. We target the thead rather than the whole card so
  // we don't include the filter bar in what scrolls into view.
  const theadRef = useRef(null)
  const goToPage = (next) => {
    setPage(next)
    requestAnimationFrame(() => {
      theadRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

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
    if (sortKey === key) emit({ sortDir: sortDir === 'asc' ? 'desc' : 'asc' })
    else emit({ sortKey: key, sortDir: 'desc' })
  }

  const total = filtered.length
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(page, pageCount - 1)
  const pageRows = total > pageSize
    ? filtered.slice(safePage * pageSize, (safePage + 1) * pageSize)
    : filtered
  const showPagination = total > pageSize
  const rangeStart = total === 0 ? 0 : safePage * pageSize + 1
  const rangeEnd = Math.min(total, (safePage + 1) * pageSize)

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div data-print="hide" className="flex flex-col gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800 sm:flex-row sm:items-center">
        <div className="flex flex-wrap gap-1">
          {ACTION_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => emit({ filter: f.id })}
              aria-pressed={filter === f.id}
              className={
                'rounded px-3 py-1.5 text-xs font-medium ring-1 ring-inset transition ' +
                (filter === f.id
                  ? 'bg-indigo-600 text-white ring-indigo-600'
                  : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800')
              }
            >
              {f.label} <span className="opacity-70">({counts[f.id] ?? 0})</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 sm:ml-auto">
          <div className="relative w-full sm:w-64">
            <input
              value={localQuery}
              onChange={(e) => setLocalQuery(e.target.value)}
              placeholder="Filter issuer or CUSIP…"
              aria-label="Filter holdings by issuer or CUSIP"
              className="w-full rounded border border-slate-300 bg-white px-2 py-1 pr-7 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
            {localQuery && (
              <button
                type="button"
                onClick={() => setLocalQuery('')}
                aria-label="Clear search"
                className="absolute inset-y-0 right-1 my-auto flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                     className="h-3 w-3">
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="18" y1="6" x2="6" y2="18" />
                </svg>
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => downloadCsv(filtered, `${csvBaseName}-${filter}.csv`)}
            disabled={filtered.length === 0}
            title="Export the currently filtered & sorted rows as CSV"
            className="shrink-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            CSV
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
          <thead ref={theadRef} className="sticky top-0 bg-slate-50 dark:bg-slate-800">
            <tr>
              {COLUMNS.map((c) => {
                const isSorted = sortKey === c.key
                const ariaSort = isSorted ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
                const sortable = c.key !== 'trend'
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={sortable ? ariaSort : undefined}
                    className={
                      `font-semibold text-slate-700 dark:text-slate-300 ` +
                      (c.responsive ?? '')
                    }
                  >
                    <button
                      type="button"
                      onClick={sortable ? () => setSort(c.key) : undefined}
                      disabled={!sortable}
                      title={c.title}
                      className={
                        `flex w-full items-center gap-1 px-3 py-2 select-none ` +
                        `focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ` +
                        (c.align === 'right' ? 'justify-end' : c.align === 'center' ? 'justify-center' : 'justify-start')
                      }
                    >
                      <span>{c.label}</span>
                      {sortable && (
                        <span className={'text-slate-400 dark:text-slate-500 ' + (isSorted ? '' : 'invisible')}>
                          {sortDir === 'asc' ? '▲' : '▼'}
                        </span>
                      )}
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
            {pageRows.length === 0 && (
              <tr><td colSpan={COLUMNS.length} className="px-3 py-6 text-center text-slate-500 dark:text-slate-400">No rows.</td></tr>
            )}
            {pageRows.map((row, i) => (
              <tr key={`${row.cusip}-${row.action}-${i}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
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
                  if (c.key === 'trend') {
                    return (
                      <td key={c.key} className={`px-3 py-2 text-center ${c.responsive ?? ''}`}>
                        <SharesSparkline prior={row.shares_prior ?? 0} current={row.shares ?? 0} />
                      </td>
                    )
                  }
                  const get = c.accessor ?? ((r) => r[c.key])
                  const raw = get(row)
                  const display = c.fmt ? c.fmt(raw, row) : raw
                  const tone = c.cellTone ? c.cellTone(row) : ''
                  // For the value column, render a thin position-size bar
                  // underneath so users can eyeball concentration without
                  // reading numbers.
                  if (c.key === 'value_usd' && totalValue > 0) {
                    const pct = Math.min(100, Math.max(0, ((row.value_usd ?? 0) / totalValue) * 100))
                    return (
                      <td
                        key={c.key}
                        className={
                          `px-3 py-2 text-right tabular-nums ` +
                          `${c.className ?? ''} ${tone} ${c.responsive ?? ''}`
                        }
                      >
                        <div>{display}</div>
                        <div className="mt-1 h-1 w-full overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                          <div
                            className="h-full bg-indigo-500/70 dark:bg-indigo-400/70"
                            style={{ width: `${pct}%` }}
                            aria-label={`${pct.toFixed(1)}% of portfolio`}
                          />
                        </div>
                      </td>
                    )
                  }
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
      {showPagination && (
        <div data-print="hide" className="flex flex-col items-center justify-between gap-2 border-t border-slate-200 px-4 py-2 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-400 sm:flex-row">
          <span>
            Showing <span className="font-medium text-slate-900 dark:text-slate-100">{rangeStart.toLocaleString()}</span>–
            <span className="font-medium text-slate-900 dark:text-slate-100">{rangeEnd.toLocaleString()}</span>
            {' '}of <span className="font-medium text-slate-900 dark:text-slate-100">{total.toLocaleString()}</span>
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => goToPage(0)}
              disabled={safePage === 0}
              className="rounded border border-slate-300 bg-white px-2 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              aria-label="First page"
            >‹‹</button>
            <button
              type="button"
              onClick={() => goToPage(Math.max(0, safePage - 1))}
              disabled={safePage === 0}
              className="rounded border border-slate-300 bg-white px-2 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              aria-label="Previous page"
            >‹ Prev</button>
            <span className="px-2 tabular-nums">
              Page {safePage + 1} / {pageCount}
            </span>
            <button
              type="button"
              onClick={() => goToPage(Math.min(pageCount - 1, safePage + 1))}
              disabled={safePage >= pageCount - 1}
              className="rounded border border-slate-300 bg-white px-2 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              aria-label="Next page"
            >Next ›</button>
            <button
              type="button"
              onClick={() => goToPage(pageCount - 1)}
              disabled={safePage >= pageCount - 1}
              className="rounded border border-slate-300 bg-white px-2 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              aria-label="Last page"
            >››</button>
          </div>
        </div>
      )}
    </div>
  )
}
