import { useEffect, useState } from 'react'
import {
  aggregateAcrossInvestors,
  asOfQuarter,
  loadAllFilers,
  loadSummary,
} from '../data.js'
import { site } from '../site.js'
import InvestorCard from '../components/InvestorCard.jsx'
import MoverList from '../components/MoverList.jsx'

export default function Home() {
  const [state, setState] = useState({ status: 'loading' })

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const summary = await loadSummary()
        const filerResults = await loadAllFilers(summary)
        const moves = aggregateAcrossInvestors(filerResults)
        const reportDate = asOfQuarter(filerResults)
        if (!alive) return
        setState({ status: 'ok', summary, filerResults, moves, reportDate })
      } catch (err) {
        if (!alive) return
        setState({ status: 'error', error: String(err.message ?? err) })
      }
    })()
    return () => { alive = false }
  }, [])

  if (state.status === 'loading') {
    return <Centered>Loading the latest 13F data…</Centered>
  }
  if (state.status === 'error') {
    return (
      <Centered>
        <div className="rounded border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          <p className="font-semibold">Could not load data</p>
          <p className="mt-1 font-mono text-xs">{state.error}</p>
        </div>
      </Centered>
    )
  }

  const { summary, filerResults, moves, reportDate } = state

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <Hero
        tagline={site.tagline}
        reportDate={reportDate}
        generatedAt={summary.generated_at}
        filerCount={filerResults.length}
      />

      <section className="mt-10 grid gap-6 md:grid-cols-2">
        <Panel
          title="Most-bought stocks"
          subtitle="Net dollars added across tracked investors"
        >
          <MoverList rows={moves.buys} kind="buy" />
        </Panel>
        <Panel
          title="Most-sold stocks"
          subtitle="Net dollars trimmed or exited across tracked investors"
        >
          <MoverList rows={moves.sells} kind="sell" />
        </Panel>
      </section>

      <section className="mt-12">
        <h2 className="text-lg font-semibold text-slate-900">All tracked investors</h2>
        <p className="mt-1 text-sm text-slate-600">
          Click an investor to see their full holdings and quarter-over-quarter changes.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filerResults.map(({ filer, data }) => (
            <InvestorCard key={filer.cik} filer={filer} data={data} />
          ))}
        </div>
      </section>

      <Footer />
    </main>
  )
}

function Hero({ tagline, reportDate, generatedAt, filerCount }) {
  return (
    <section className="rounded-2xl bg-gradient-to-br from-indigo-600 to-indigo-800 px-6 py-8 text-white shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-widest text-indigo-200">
        Quarter ending {reportDate ?? '—'}
      </p>
      <h1 className="mt-2 text-3xl font-bold sm:text-4xl">{tagline}</h1>
      <p className="mt-3 max-w-2xl text-sm text-indigo-100">
        Aggregated stock-on-hand changes from {filerCount} institutional investors'
        quarterly 13F-HR filings with the SEC. Data refreshed {generatedAt}.
      </p>
    </section>
  )
}

function Panel({ title, subtitle, children }) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        <p className="text-xs text-slate-500">Top 10</p>
      </div>
      <p className="mb-2 text-xs text-slate-500">{subtitle}</p>
      {children}
    </div>
  )
}

function Footer() {
  return (
    <footer className="mt-12 border-t border-slate-200 pt-6 text-xs text-slate-500">
      <p>
        Data sourced from SEC EDGAR 13F-HR filings. 13F is reported quarterly with a
        45-day lag — figures here reflect the most recent reported quarter and are not
        a real-time portfolio.
      </p>
    </footer>
  )
}

function Centered({ children }) {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-3xl items-center justify-center px-4 text-sm text-slate-500">
      {children}
    </main>
  )
}
