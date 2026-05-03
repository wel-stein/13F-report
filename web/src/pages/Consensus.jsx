import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  aggregateConsensus,
  asOfQuarter,
  loadAllFilers,
  loadSummary,
} from '../data.js'
import { fmtCompactUSD, fmtSignedUSD } from '../format.js'

export default function Consensus() {
  const [state, setState] = useState({ status: 'loading' })
  const [minFunds, setMinFunds] = useState(2)
  const [limit, setLimit] = useState(20)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const summary = await loadSummary()
        const filerResults = await loadAllFilers(summary)
        const reportDate = asOfQuarter(filerResults)
        if (!alive) return
        setState({ status: 'ok', summary, filerResults, reportDate })
      } catch (err) {
        if (!alive) return
        setState({ status: 'error', error: String(err.message ?? err) })
      }
    })()
    return () => { alive = false }
  }, [])

  const aggregate = useMemo(() => {
    if (state.status !== 'ok') return null
    return aggregateConsensus(state.filerResults, {
      minBuyers: minFunds,
      minSellers: minFunds,
    })
  }, [state, minFunds])

  if (state.status === 'loading') return <Centered>Computing consensus across funds…</Centered>
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

  const { buys, sells, totalFilers } = aggregate

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <Hero reportDate={state.reportDate} totalFilers={totalFilers} />

      <Filters
        minFunds={minFunds}
        setMinFunds={setMinFunds}
        limit={limit}
        setLimit={setLimit}
        totalFilers={totalFilers}
      />

      {buys.length === 0 && sells.length === 0 ? (
        <DegenerateState minFunds={minFunds} totalFilers={totalFilers} />
      ) : (
        <section className="mt-6 grid gap-6 lg:grid-cols-2">
          <Panel
            title="Consensus buys"
            subtitle="Stocks where the most funds bought"
            tone="emerald"
            empty="No stocks meet the threshold."
          >
            <ConsensusList rows={buys.slice(0, limit)} kind="buy" totalFilers={totalFilers} />
          </Panel>
          <Panel
            title="Consensus sells"
            subtitle="Stocks where the most funds trimmed or exited"
            tone="rose"
            empty="No stocks meet the threshold."
          >
            <ConsensusList rows={sells.slice(0, limit)} kind="sell" totalFilers={totalFilers} />
          </Panel>
        </section>
      )}

      <footer className="mt-10 border-t border-slate-200 pt-6 text-xs text-slate-500">
        <p>
          A fund is counted in the buyer column if its 13F shows a <em>new</em> or <em>added</em>
          position; in the seller column for <em>trim</em> or <em>exit</em>; otherwise as a
          holder. Aggregation is by CUSIP × class × put/call. Ties broken by net dollar flow.
        </p>
      </footer>
    </main>
  )
}

function Hero({ reportDate, totalFilers }) {
  return (
    <section className="rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 px-6 py-8 text-white shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-300">
        Quarter ending {reportDate ?? '—'}
      </p>
      <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Consensus picks</h1>
      <p className="mt-3 max-w-2xl text-sm text-slate-300">
        Stocks where the most managers are quietly agreeing — ranked by{' '}
        <span className="font-semibold">net fund agreement</span> (buyers minus sellers),
        not dollar size. Drawn from {totalFilers} 13F filers' latest quarter.
      </p>
    </section>
  )
}

function Filters({ minFunds, setMinFunds, limit, setLimit, totalFilers }) {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-4 rounded-lg border border-slate-200 bg-white px-4 py-3">
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <span className="font-medium">Minimum funds on a side:</span>
        <select
          value={minFunds}
          onChange={(e) => setMinFunds(Number(e.target.value))}
          className="rounded border border-slate-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n} disabled={n > totalFilers}>{n}</option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <span className="font-medium">Show top:</span>
        <select
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
          className="rounded border border-slate-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <p className="ml-auto text-xs text-slate-500">
        {totalFilers} filers in dataset
      </p>
    </div>
  )
}

function Panel({ title, subtitle, tone, children, empty }) {
  const accent = tone === 'emerald' ? 'border-emerald-300' : 'border-rose-300'
  return (
    <div>
      <div className={`mb-2 border-l-4 ${accent} pl-3`}>
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        <p className="text-xs text-slate-500">{subtitle}</p>
      </div>
      {children}
    </div>
  )
}

function ConsensusList({ rows, kind, totalFilers }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
        No stocks meet the threshold.
      </p>
    )
  }
  return (
    <ol className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
      {rows.map((r, i) => (
        <ConsensusRow key={`${r.cusip}-${r.put_call}`} row={r} rank={i + 1} kind={kind} totalFilers={totalFilers} />
      ))}
    </ol>
  )
}

function ConsensusRow({ row, rank, kind, totalFilers }) {
  const total = Math.max(row.coverage, 1)
  const buyPct  = (row.buyer_count  / total) * 100
  const sellPct = (row.seller_count / total) * 100
  const holdPct = (row.holder_count / total) * 100
  const net = row.net
  const netClass = net > 0 ? 'text-emerald-700' : net < 0 ? 'text-rose-700' : 'text-slate-500'
  const movers = kind === 'buy' ? row.buyers : row.sellers
  const counter = kind === 'buy' ? row.sellers : row.buyers
  const moverLabel = kind === 'buy' ? 'Buyers' : 'Sellers'
  const counterLabel = kind === 'buy' ? 'Sellers' : 'Buyers'

  return (
    <li className="px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-900">
            <span className="mr-2 text-xs text-slate-400">{rank}.</span>
            {row.issuer}
            {row.put_call && (
              <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs uppercase text-slate-600">
                {row.put_call}
              </span>
            )}
          </p>
          <p className="mt-0.5 font-mono text-xs text-slate-500">CUSIP {row.cusip} · {row.class}</p>
        </div>
        <div className="text-right">
          <p className={`text-lg font-semibold tabular-nums ${netClass}`}>
            {net > 0 ? '+' : ''}{net}
          </p>
          <p className="text-[10px] uppercase tracking-wide text-slate-500">net funds</p>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <div className="flex h-2 flex-1 overflow-hidden rounded bg-slate-100">
          {buyPct  > 0 && <div className="bg-emerald-500" style={{ width: `${buyPct}%` }}  title={`${row.buyer_count} buying`} />}
          {sellPct > 0 && <div className="bg-rose-500"    style={{ width: `${sellPct}%` }} title={`${row.seller_count} selling`} />}
          {holdPct > 0 && <div className="bg-slate-300"   style={{ width: `${holdPct}%` }} title={`${row.holder_count} holding`} />}
        </div>
        <p className="whitespace-nowrap text-xs tabular-nums text-slate-600">
          <span className="text-emerald-700">{row.buyer_count} buy</span>
          <span className="text-slate-400"> · </span>
          <span className="text-rose-700">{row.seller_count} sell</span>
          <span className="text-slate-400"> · </span>
          <span className="text-slate-600">{row.holder_count} hold</span>
        </p>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className="text-xs text-slate-500">{moverLabel}:</span>
        {movers.slice(0, 6).map((m) => (
          <Link
            key={m.cik}
            to={`/investor/${m.cik}`}
            className={
              'rounded px-2 py-0.5 text-xs hover:bg-slate-200 ' +
              (kind === 'buy' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800')
            }
            title={`${m.name}: ${fmtSignedUSD(m.delta_value_usd)} (${m.action})`}
          >
            {m.name} <span className="opacity-70">{fmtCompactUSD(Math.abs(m.delta_value_usd))}</span>
          </Link>
        ))}
        {movers.length > 6 && (
          <span className="rounded px-2 py-0.5 text-xs text-slate-500">
            +{movers.length - 6} more
          </span>
        )}
      </div>

      {counter.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <span className="text-xs text-slate-500">{counterLabel}:</span>
          {counter.slice(0, 4).map((m) => (
            <Link
              key={m.cik}
              to={`/investor/${m.cik}`}
              className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-200"
              title={`${m.name}: ${fmtSignedUSD(m.delta_value_usd)} (${m.action})`}
            >
              {m.name}
            </Link>
          ))}
          {counter.length > 4 && (
            <span className="rounded px-2 py-0.5 text-xs text-slate-500">
              +{counter.length - 4} more
            </span>
          )}
        </div>
      )}
    </li>
  )
}

function DegenerateState({ minFunds, totalFilers }) {
  return (
    <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-900">
      <p className="font-semibold">No consensus to surface yet</p>
      <p className="mt-1 text-xs">
        With <strong>{totalFilers}</strong> filer{totalFilers === 1 ? '' : 's'} and a minimum
        of <strong>{minFunds}</strong> funds-on-a-side, no stock crosses the threshold.
        Lower the minimum, or run the downloader against more filers in{' '}
        <code className="rounded bg-amber-100 px-1">investors.json</code> to get richer signal.
      </p>
    </div>
  )
}

function Centered({ children }) {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-3xl items-center justify-center px-4 text-sm text-slate-500">
      {children}
    </main>
  )
}
