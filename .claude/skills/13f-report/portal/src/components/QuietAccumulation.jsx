import { useMemo, useState } from 'react'
import { fmtSignedUSD } from '../format.js'
import ThesisCard from './ThesisCard.jsx'

// Discretionary "alpha" managers — the ones whose buys carry stock-picking
// signal. The passive/index/custodial giants (Vanguard, BlackRock, State
// Street, Geode, Northern Trust, BNY Mellon, Norges, UBS) and the pure
// market-makers hold thousands of names mechanically, so an "active only"
// toggle strips that breadth noise from the screen.
const ACTIVE_MANAGERS = new Set([
  'Berkshire Hathaway',
  'Bridgewater Associates',
  'Renaissance Technologies',
  'Citadel Advisors',
  'Two Sigma Investments',
  'Millennium Management',
  'Wellington Management',
  'T. Rowe Price Associates',
  'ARK Investment Management',
  'FMR (Fidelity)',
])

// Issuer-name hints for ETFs / index trusts we don't want in a "stocks" screen.
const FUND_HINTS = ['ISHARES', 'SPDR', 'VANGUARD', ' ETF', 'INVESCO QQQ', 'SELECT SECTOR', 'PROSHARES']
const looksLikeFund = (issuer) => {
  const u = (issuer || '').toUpperCase()
  return FUND_HINTS.some((h) => u.includes(h))
}

// Per-security accumulation profiles, precomputed across every filer by
// download_13f.py (aggregates.json, filers referenced by index). Only names
// that are a top-10 position of NOBODY ship, so "quiet" is already applied.
function buildProfiles(aggregates) {
  const names = aggregates?.filers ?? []
  return (aggregates?.accumulation ?? []).map((a) => {
    const buyers = a.buyers.map((i) => names[i])
    const newFilers = new Set(a.new.map((i) => names[i]))
    const active = buyers.filter((n) => ACTIVE_MANAGERS.has(n))
    return {
      cusip: a.cusip,
      issuer: a.issuer,
      sector: a.sector,
      buyers: new Set(buyers),
      newFilers,
      activeBuyers: new Set(active),
      activeNew: new Set(active.filter((n) => newFilers.has(n))),
      activeAdd: new Set(active.filter((n) => !newFilers.has(n))),
      top10Count: 0,
      netBuyUsd: a.net_buy_usd,
    }
  })
}

function scoreRow(e, activeOnly) {
  // Initiations count double — opening a brand-new position is a stronger
  // tell than nudging an existing one up.
  if (activeOnly) return e.activeNew.size * 2 + e.activeAdd.size
  return e.newFilers.size * 2 + (e.buyers.size - e.newFilers.size)
}

function Toggle({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        'rounded-md px-3 py-3 text-xs font-medium ring-1 ring-inset transition sm:py-1.5 ' +
        (active
          ? 'bg-indigo-600 text-white ring-indigo-600'
          : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800')
      }
    >
      {children}
    </button>
  )
}

const LIMIT = 50

export default function QuietAccumulation({ summary, aggregates, tickers, fundamentals }) {
  const [activeOnly, setActiveOnly] = useState(false)
  const [minBuyers, setMinBuyers] = useState(8)
  const [selected, setSelected] = useState(null)

  const ok = (summary?.filers ?? []).filter((f) => !f.error)
  const loaded = aggregates !== undefined

  const profiles = useMemo(() => buildProfiles(aggregates), [aggregates])

  // When "active only" is on, the floor is interpreted against active buyers;
  // its sensible range (max 10 active managers) is smaller, so cap it.
  const effMin = activeOnly ? Math.min(minBuyers, 5) : minBuyers

  const rows = useMemo(() => {
    return profiles
      .filter((e) => e.issuer && !looksLikeFund(e.issuer))
      .filter((e) => e.top10Count === 0)
      .filter((e) => (activeOnly ? e.activeBuyers.size : e.buyers.size) >= effMin)
      .map((e) => ({ ...e, score: scoreRow(e, activeOnly) }))
      .sort((a, b) => b.score - a.score || b.netBuyUsd - a.netBuyUsd)
      .slice(0, LIMIT)
  }, [profiles, activeOnly, effMin])

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100 sm:text-2xl">
          Quiet Accumulation · 悄悄吸筹
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600 dark:text-slate-400">
          Stocks that many filers <span className="font-medium text-emerald-700 dark:text-emerald-400">bought or
          opened</span> this quarter but that are a top-10 position of <span className="font-medium">no one</span> —
          broad institutional accumulation before it becomes a headline conviction name. Ranked by a conviction
          score that weights brand-new positions double. Options legs excluded.
          <span className="text-slate-500 dark:text-slate-500"> 点击任意行查看个股论点卡(EDGAR 基本面 + Rule of 40)。</span>
          {summary?.generated_at && (
            <span className="text-slate-500 dark:text-slate-500"> · generated {summary.generated_at}</span>
          )}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Universe</span>
          <Toggle active={!activeOnly} onClick={() => setActiveOnly(false)}>All filers</Toggle>
          <Toggle active={activeOnly} onClick={() => setActiveOnly(true)}>Active managers only</Toggle>
        </div>
        <label className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-400">
          <span className="uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Min {activeOnly ? 'active ' : ''}buyers
          </span>
          <input
            type="range"
            min={activeOnly ? 2 : 4}
            max={activeOnly ? 5 : 16}
            value={effMin}
            onChange={(e) => setMinBuyers(Number(e.target.value))}
            className="h-8 w-32 cursor-pointer accent-indigo-600 sm:h-1"
          />
          <span className="w-5 tabular-nums text-slate-900 dark:text-slate-100">{effMin}</span>
        </label>
      </div>

      {aggregates === null && (
        <p className="text-sm text-rose-700 dark:text-rose-400">
          aggregates.json not found; re-run the downloader to build it.
        </p>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-baseline justify-between border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Quiet accumulators {rows.length > 0 && <span className="font-normal text-slate-500 dark:text-slate-400">· top {rows.length}</span>}
          </h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {activeOnly ? '10 active managers' : `${ok.length} filers`}
          </span>
        </div>
        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
            {loaded ? 'No securities match the current filters.' : 'Loading…'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm dark:divide-slate-800">
              <thead className="bg-slate-50 dark:bg-slate-800/50">
                <tr className="text-slate-700 dark:text-slate-300">
                  <th scope="col" className="px-3 py-2 text-left font-semibold">#</th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">Ticker</th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">Issuer</th>
                  <th scope="col" className="hidden px-3 py-2 text-left font-semibold sm:table-cell">Sector</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Buyers</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">New</th>
                  <th scope="col" className="hidden px-3 py-2 text-right font-semibold md:table-cell">Net bought</th>
                  <th scope="col" className="hidden px-3 py-2 text-left font-semibold lg:table-cell">Who's buying</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
                {rows.map((r, i) => {
                  const ticker = tickers?.[r.cusip]
                  const buyerNames = activeOnly ? [...r.activeBuyers] : [...r.buyers]
                  const newCount = activeOnly ? r.activeNew.size : r.newFilers.size
                  const buyerCount = activeOnly ? r.activeBuyers.size : r.buyers.size
                  const openCard = () => setSelected({
                    issuer: r.issuer, ticker, sector: r.sector,
                    buyerCount, newCount, netBuyUsd: r.netBuyUsd,
                  })
                  return (
                    <tr
                      key={r.cusip}
                      onClick={openCard}
                      title="查看个股论点卡"
                      className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    >
                      <td className="px-3 py-2 tabular-nums text-slate-400 dark:text-slate-500">{i + 1}</td>
                      <td className="px-3 py-2">
                        {ticker ? (
                          <span className="inline-flex rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-semibold text-slate-800 group-hover:ring-1 dark:bg-slate-800 dark:text-slate-200">
                            {ticker}
                          </span>
                        ) : (
                          <span className="text-slate-300 dark:text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <p className="font-medium text-slate-900 dark:text-slate-100">{r.issuer}</p>
                        <p className="font-mono text-[11px] text-slate-400 dark:text-slate-500">{r.cusip}</p>
                      </td>
                      <td className="hidden px-3 py-2 text-slate-600 dark:text-slate-400 sm:table-cell">{r.sector ?? '—'}</td>
                      <td className="px-3 py-2 text-right">
                        <span className="inline-flex rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-950/60 dark:text-emerald-300 dark:ring-emerald-400/30 tabular-nums">
                          {buyerCount}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-300">
                        {newCount > 0 ? newCount : '—'}
                      </td>
                      <td className="hidden px-3 py-2 text-right tabular-nums text-emerald-700 dark:text-emerald-400 md:table-cell">
                        {r.netBuyUsd > 0 ? fmtSignedUSD(r.netBuyUsd) : '—'}
                      </td>
                      <td className="hidden max-w-xs px-3 py-2 text-[11px] text-slate-500 dark:text-slate-400 lg:table-cell">
                        <span className="line-clamp-2">
                          {buyerNames.slice(0, 4).join(' · ')}
                          {buyerNames.length > 4 ? ` +${buyerNames.length - 4}` : ''}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        13F data is a quarterly, 45-day-lagged, long-only snapshot — accumulation here means more institutions held
        more shares at quarter-end, not a real-time price signal. Tickers are best-effort (private / unlisted issuers
        show “—”). Always confirm before acting.
      </p>

      {selected && (
        <ThesisCard
          row={selected}
          fundamentals={selected.ticker ? fundamentals?.[selected.ticker] : null}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}
