import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { loadFiler, loadSummary } from '../data.js'
import {
  ACTION_BADGE,
  fmtCompactUSD,
  fmtPct,
  fmtShares,
  fmtSignedShares,
  fmtSignedUSD,
} from '../format.js'

export default function Investor() {
  const { cik } = useParams()
  const [state, setState] = useState({ status: 'loading' })

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const summary = await loadSummary()
        const filer = (summary.filers ?? []).find((f) => String(f.cik) === String(cik))
        if (!filer) throw new Error('Investor not in summary.json')
        const data = await loadFiler(filer)
        if (!alive) return
        setState({ status: 'ok', filer, data, generatedAt: summary.generated_at })
      } catch (err) {
        if (!alive) return
        setState({ status: 'error', error: String(err.message ?? err) })
      }
    })()
    return () => { alive = false }
  }, [cik])

  if (state.status === 'loading') return <Centered>Loading…</Centered>
  if (state.status === 'error') {
    return (
      <Centered>
        <div className="rounded border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          <p className="font-semibold">Could not load investor</p>
          <p className="mt-1 font-mono text-xs">{state.error}</p>
          <p className="mt-3">
            <Link to="/" className="text-indigo-700 hover:underline">← Back to overview</Link>
          </p>
        </div>
      </Centered>
    )
  }

  const { filer, data, generatedAt } = state
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex items-center justify-between">
        <Link to="/" className="text-sm text-indigo-700 hover:underline">← All investors</Link>
        <Link
          to={`/investor/${filer.cik}/whalecheck`}
          className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700"
        >
          WhaleCheck — strategy vs. S&P 500 →
        </Link>
      </div>
      <Header filer={filer} data={data} generatedAt={generatedAt} />
      <div className="mt-6">
        <Stats filer={filer} data={data} />
      </div>
      <div className="mt-8">
        <h2 className="mb-2 text-lg font-semibold text-slate-900">Stock-on-hand vs. prior quarter</h2>
        <HoldingsList holdings={data.holdings ?? []} exited={data.exited ?? []} />
      </div>
    </main>
  )
}

function Header({ filer, data, generatedAt }) {
  const latest = data.latest_filing
  const prior  = data.prior_filing
  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-3xl font-bold text-slate-900">{filer.name}</h1>
        <p className="text-xs text-slate-500">CIK {filer.cik} · generated {generatedAt}</p>
      </div>
      <p className="mt-1 text-sm text-slate-600">
        Latest 13F-HR — report{' '}
        <span className="font-medium">{latest?.report_date}</span>
        {' '}(filed {latest?.filing_date})
        {prior && (
          <>
            {' '}· comparing to <span className="font-medium">{prior.report_date}</span>
          </>
        )}
      </p>
    </div>
  )
}

function Stats({ filer, data }) {
  const buys  = (data.holdings ?? []).filter((h) => h.action === 'new' || h.action === 'add')
  const trim  = (data.holdings ?? []).filter((h) => h.action === 'trim')
  const valueDelta =
    data.total_value_usd_prior != null
      ? data.total_value_usd - data.total_value_usd_prior
      : null

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Card
        label="Total portfolio value"
        value={fmtCompactUSD(filer.total_value_usd)}
        sub={valueDelta != null ? `${fmtSignedUSD(valueDelta)} vs prior` : undefined}
      />
      <Card label="Holdings" value={(filer.holdings_count ?? 0).toLocaleString()} />
      <Card
        label="New + added"
        value={String(buys.length)}
        tone="emerald"
      />
      <Card
        label="Trimmed + exited"
        value={String(trim.length + (data.exited?.length ?? 0))}
        tone="rose"
      />
    </div>
  )
}

function Card({ label, value, sub, tone = 'slate' }) {
  const cls =
    tone === 'emerald'
      ? 'text-emerald-700'
      : tone === 'rose'
        ? 'text-rose-700'
        : 'text-slate-900'
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${cls}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  )
}

const FILTERS = [
  { id: 'all',  label: 'All',     match: () => true },
  { id: 'new',  label: 'New',     match: (h) => h.action === 'new' },
  { id: 'add',  label: 'Added',   match: (h) => h.action === 'add' },
  { id: 'trim', label: 'Trimmed', match: (h) => h.action === 'trim' },
  { id: 'exit', label: 'Exited',  match: (h) => h.action === 'exit' },
  { id: 'hold', label: 'Hold',    match: (h) => h.action === 'hold' },
]

function HoldingsList({ holdings, exited }) {
  const all = useMemo(() => [...holdings, ...exited], [holdings, exited])
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')

  const counts = useMemo(() => {
    const c = { all: all.length }
    for (const f of FILTERS.slice(1)) c[f.id] = all.filter(f.match).length
    return c
  }, [all])

  const rows = useMemo(() => {
    const f = FILTERS.find((x) => x.id === filter) ?? FILTERS[0]
    const q = query.trim().toLowerCase()
    let out = all.filter(f.match)
    if (q) out = out.filter((r) => r.issuer.toLowerCase().includes(q) || r.cusip.toLowerCase().includes(q))
    return out.sort((a, b) => Math.abs(b.delta_value_usd) - Math.abs(a.delta_value_usd))
  }, [all, filter, query])

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={
                'rounded px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition ' +
                (filter === f.id
                  ? 'bg-indigo-600 text-white ring-indigo-600'
                  : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50')
              }
            >
              {f.label} <span className="opacity-70">({counts[f.id] ?? 0})</span>
            </button>
          ))}
        </div>
        <div className="ml-auto">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter issuer or CUSIP…"
            className="w-64 rounded border border-slate-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <Th>Issuer</Th>
              <Th>CUSIP</Th>
              <Th align="right">Shares (prior)</Th>
              <Th align="right">Shares (current)</Th>
              <Th align="right">Δ Shares</Th>
              <Th align="right">Δ %</Th>
              <Th align="right">Value (current)</Th>
              <Th align="right">Δ Value</Th>
              <Th>Action</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {rows.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-500">No rows.</td></tr>
            )}
            {rows.map((r) => {
              const dvTone =
                r.delta_value_usd > 0 ? 'text-emerald-700'
                : r.delta_value_usd < 0 ? 'text-rose-700'
                : 'text-slate-500'
              const dsTone =
                r.delta_shares > 0 ? 'text-emerald-700'
                : r.delta_shares < 0 ? 'text-rose-700'
                : 'text-slate-500'
              return (
                <tr key={`${r.cusip}-${r.action}`} className="hover:bg-slate-50">
                  <td className="px-3 py-2">{r.issuer}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.cusip}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtShares(r.shares_prior)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtShares(r.shares)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${dsTone}`}>{fmtSignedShares(r.delta_shares)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${dsTone}`}>{fmtPct(r.shares, r.shares_prior)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtCompactUSD(r.value_usd)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${dvTone}`}>{fmtSignedUSD(r.delta_value_usd)}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${ACTION_BADGE[r.action] ?? ACTION_BADGE.hold}`}>
                      {r.action}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Th({ children, align }) {
  return (
    <th
      scope="col"
      className={`px-3 py-2 font-semibold text-slate-700 ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      {children}
    </th>
  )
}

function Centered({ children }) {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-3xl items-center justify-center px-4 text-sm text-slate-500">
      {children}
    </main>
  )
}
