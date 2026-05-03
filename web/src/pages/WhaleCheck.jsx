import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { loadFilerHistory, loadSummary } from '../data.js'

export default function WhaleCheck() {
  const { cik } = useParams()
  const [state, setState] = useState({ status: 'loading' })

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const summary = await loadSummary()
        const filer = (summary.filers ?? []).find((f) => String(f.cik) === String(cik))
        if (!filer) throw new Error('Investor not in summary.json')
        const history = await loadFilerHistory(filer)
        if (!alive) return
        setState({ status: 'ok', filer, history })
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
          <p className="font-semibold">Could not load WhaleCheck</p>
          <p className="mt-1 font-mono text-xs">{state.error}</p>
          <BackLink cik={cik} />
        </div>
      </Centered>
    )
  }

  const { filer, history } = state

  if (!history) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <BackLink cik={cik} />
        <h1 className="mt-3 text-3xl font-bold text-slate-900">
          WhaleCheck — {filer.name}
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          See how this fund's 13F-mirroring strategy would have performed compared to the S&P&nbsp;500.
        </p>
        <div className="mt-6 rounded-lg border border-slate-200 bg-white p-6 text-sm">
          <p className="font-semibold text-slate-900">No history file yet</p>
          <p className="mt-1 text-slate-600">
            Run the WhaleCheck history generator to produce a series for this filer:
          </p>
          <pre className="mt-3 overflow-x-auto rounded bg-slate-900 px-3 py-2 text-xs text-slate-100">
{`python3 .claude/skills/13f-report/generate_history_fixture.py`}
          </pre>
          <p className="mt-3 text-xs text-slate-500">
            That script writes plausible <em>synthetic</em> data so this page renders for demos.
            Real backtesting requires multi-quarter holdings + historical prices — see SKILL.md.
          </p>
        </div>
      </main>
    )
  }

  const stats = computeStats(history.series)

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <BackLink cik={cik} />
      <header className="mt-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-indigo-600">
          WhaleCheck
        </p>
        <h1 className="mt-1 text-3xl font-bold text-slate-900">{filer.name}</h1>
        <p className="mt-1 text-sm text-slate-600">
          13F-mirroring strategy vs.{' '}
          <span className="font-medium">{history.benchmark}</span> over the last{' '}
          {history.series.length} quarters.
        </p>
      </header>

      {history.is_synthetic && <DemoBanner generatedAt={history.generated_at} />}

      <section className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Strategy total return"
          value={fmtPct(stats.portTotal)}
          tone={stats.portTotal >= 0 ? 'emerald' : 'rose'}
        />
        <Stat
          label="S&P 500 total return"
          value={fmtPct(stats.spyTotal)}
        />
        <Stat
          label="Alpha (excess return)"
          value={fmtPct(stats.alpha, true)}
          tone={stats.alpha >= 0 ? 'emerald' : 'rose'}
          sub={stats.alpha >= 0 ? 'beats S&P 500' : 'lags S&P 500'}
        />
        <Stat
          label="Quarters beating S&P"
          value={`${stats.beat}/${history.series.length}`}
          sub={`${Math.round((stats.beat / history.series.length) * 100)}% win rate`}
        />
      </section>

      <section className="mt-8 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-700">
          Cumulative return — strategy vs. S&P 500
        </h2>
        <div className="mt-2 h-72 w-full">
          <ResponsiveContainer>
            <LineChart data={history.series} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="quarter" tick={{ fontSize: 12 }} stroke="#64748b" />
              <YAxis
                tick={{ fontSize: 12 }}
                stroke="#64748b"
                tickFormatter={(v) => `${v}%`}
                width={56}
              />
              <Tooltip
                formatter={(v) => `${Number(v).toFixed(2)}%`}
                labelFormatter={(l) => `Quarter ${l}`}
                contentStyle={{ fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line
                name="Strategy"
                type="monotone"
                dataKey="portfolio_cum_pct"
                stroke="#4f46e5"
                strokeWidth={2}
                dot={{ r: 2 }}
              />
              <Line
                name="S&P 500"
                type="monotone"
                dataKey="spy_cum_pct"
                stroke="#64748b"
                strokeWidth={2}
                strokeDasharray="4 4"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">
          Quarter-by-quarter
        </h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <Th>Quarter</Th>
                <Th>End</Th>
                <Th align="right">Strategy QoQ</Th>
                <Th align="right">S&P 500 QoQ</Th>
                <Th align="right">Excess</Th>
                <Th align="right">Strategy cum.</Th>
                <Th align="right">S&P 500 cum.</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {history.series.map((row) => {
                const excess = row.portfolio_return_pct - row.spy_return_pct
                return (
                  <tr key={row.quarter} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium text-slate-900">{row.quarter}</td>
                    <td className="px-3 py-2 text-slate-500">{row.report_date}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${tone(row.portfolio_return_pct)}`}>
                      {fmtPct(row.portfolio_return_pct, true)}
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums ${tone(row.spy_return_pct)}`}>
                      {fmtPct(row.spy_return_pct, true)}
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums ${tone(excess)}`}>
                      {fmtPct(excess, true)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {fmtPct(row.portfolio_cum_pct, true)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                      {fmtPct(row.spy_cum_pct, true)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <p className="mt-6 text-xs text-slate-500">
        Methodology note: a 13F-mirroring strategy assumes you replicated this filer's reported
        positions at each quarter's filing date and held until the next. Real backtesting requires
        multi-quarter holdings plus historical close prices — see the skill README. Numbers
        ignore transaction costs, taxes, and the 45-day reporting lag.
      </p>
    </main>
  )
}

function computeStats(series) {
  if (!series?.length) return { portTotal: 0, spyTotal: 0, alpha: 0, beat: 0 }
  const last = series[series.length - 1]
  const beat = series.reduce(
    (n, r) => n + (r.portfolio_return_pct > r.spy_return_pct ? 1 : 0),
    0,
  )
  return {
    portTotal: last.portfolio_cum_pct,
    spyTotal:  last.spy_cum_pct,
    alpha:     last.portfolio_cum_pct - last.spy_cum_pct,
    beat,
  }
}

function fmtPct(n, signed = false) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  const sign = signed && n > 0 ? '+' : ''
  return `${sign}${n.toFixed(1)}%`
}

function tone(n) {
  return n > 0 ? 'text-emerald-700' : n < 0 ? 'text-rose-700' : 'text-slate-500'
}

function Stat({ label, value, sub, tone = 'slate' }) {
  const cls =
    tone === 'emerald'
      ? 'text-emerald-700'
      : tone === 'rose'
        ? 'text-rose-700'
        : 'text-slate-900'
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${cls}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  )
}

function DemoBanner({ generatedAt }) {
  return (
    <div className="mt-4 rounded border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
      <p className="font-semibold">Demo data</p>
      <p className="mt-0.5 text-xs">
        These returns are <strong>synthetic</strong>, generated{' '}
        {generatedAt ? <>on {generatedAt} </> : null}
        from a CIK-seeded random walk so the WhaleCheck UI has something to render.
        Wiring real returns requires multi-quarter holdings + historical prices; see SKILL.md.
      </p>
    </div>
  )
}

function Th({ children, align }) {
  return (
    <th
      scope="col"
      className={`px-3 py-2 font-semibold text-slate-700 ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  )
}

function BackLink({ cik }) {
  return (
    <Link to={`/investor/${cik}`} className="text-sm text-indigo-700 hover:underline">
      ← Back to {cik ? 'investor' : 'overview'}
    </Link>
  )
}

function Centered({ children }) {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-3xl items-center justify-center px-4 text-sm text-slate-500">
      {children}
    </main>
  )
}

