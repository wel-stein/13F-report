import { useState, useEffect, useCallback, useRef } from 'react'
import { hasFmpKey, screenStocks, getProfiles, getRatiosTTM } from '../api/fmp.js'
import { hasPolygonKey, getSnapshots } from '../api/polygon.js'
import { fmtCompactUSD } from '../format.js'

// ─── constants ────────────────────────────────────────────────────────────────

const SECTORS = [
  'All Sectors',
  'Technology', 'Healthcare', 'Financials', 'Consumer Staples',
  'Energy', 'Industrials', 'Utilities', 'Real Estate',
  'Materials', 'Consumer Discretionary', 'Communication Services',
]

const CAP_PRESETS = [
  { label: 'Any',        value: 'any',   min: 100_000_000 },
  { label: 'Small-cap',  value: 'small', min: 300_000_000,  max: 2_000_000_000 },
  { label: 'Mid-cap',    value: 'mid',   min: 2_000_000_000, max: 10_000_000_000 },
  { label: 'Large-cap',  value: 'large', min: 10_000_000_000 },
]

const COLS = [
  { key: 'symbol',      label: 'Ticker',       align: 'left' },
  { key: 'name',        label: 'Company',      align: 'left' },
  { key: 'sector',      label: 'Sector',       align: 'left' },
  { key: 'price',       label: 'Price',        align: 'right' },
  { key: 'dayChangePct',label: 'Day Chg',      align: 'right' },
  { key: 'marketCap',   label: 'Mkt Cap',      align: 'right' },
  { key: 'pe',          label: 'P/E',          align: 'right' },
  { key: 'pb',          label: 'P/B',          align: 'right' },
  { key: 'evEbitda',    label: 'EV/EBITDA',    align: 'right' },
  { key: 'dcf',         label: 'DCF Value',    align: 'right' },
  { key: 'dcfDiscount', label: 'DCF Discount', align: 'right' },
]

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtNum(v, digits = 1) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return v.toFixed(digits)
}

function fmtPrice(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtPct(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(1)}%`
}

function dayChangeCls(v) {
  if (v === null || v === undefined) return 'text-slate-400'
  if (v > 0) return 'text-emerald-600 dark:text-emerald-400'
  if (v < 0) return 'text-rose-600 dark:text-rose-400'
  return 'text-slate-500 dark:text-slate-400'
}

function discountBadgeCls(v) {
  if (v === null || !Number.isFinite(v)) return ''
  if (v >= 30) return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
  if (v >= 15) return 'bg-green-100 text-green-800 dark:bg-green-950/60 dark:text-green-300'
  return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
}

function peBadgeCls(v) {
  if (v === null || !Number.isFinite(v) || v <= 0) return ''
  if (v < 12) return 'text-emerald-600 dark:text-emerald-400 font-medium'
  if (v < 20) return 'text-green-600 dark:text-green-400'
  if (v < 30) return 'text-amber-600 dark:text-amber-400'
  return 'text-rose-600 dark:text-rose-400'
}

// ─── data fetch ───────────────────────────────────────────────────────────────

async function fetchUndervalued({ sector, exchange, capPreset }) {
  const cap = CAP_PRESETS.find((c) => c.value === capPreset) ?? CAP_PRESETS[0]
  const screened = await screenStocks({
    sector: sector === 'All Sectors' ? '' : sector,
    exchange: exchange === 'all' ? '' : exchange,
    marketCapMin: cap.min,
    marketCapMax: cap.max,
    limit: 30,
  })
  if (!screened?.length) return { stocks: [], analyzed: 0 }

  const tickers = screened.slice(0, 25).map((s) => s.symbol)

  // Profiles (includes DCF) + ratios-TTM in parallel
  const [profiles, ratioResults, snapshots] = await Promise.all([
    getProfiles(tickers),
    Promise.allSettled(tickers.map((t) => getRatiosTTM(t).then((r) => [t, r]))),
    hasPolygonKey()
      ? getSnapshots(tickers).catch(() => ({}))
      : Promise.resolve({}),
  ])

  const profileMap = Object.fromEntries((profiles ?? []).map((p) => [p.symbol, p]))
  const ratioMap = {}
  for (const r of ratioResults) {
    if (r.status === 'fulfilled' && r.value) ratioMap[r.value[0]] = r.value[1]
  }

  const screenerMap = Object.fromEntries(screened.map((s) => [s.symbol, s]))

  const merged = tickers.map((ticker) => {
    const p   = profileMap[ticker] ?? {}
    const r   = ratioMap[ticker] ?? {}
    const sc  = screenerMap[ticker] ?? {}
    const poly = snapshots[ticker] ?? {}

    const price = poly.day?.c ?? poly.lastTrade?.p ?? p.price ?? null
    const dcfValue = p.dcf ?? null
    const dcfDiscount = dcfValue && price && price > 0
      ? ((dcfValue - price) / price) * 100
      : null

    return {
      symbol:      ticker,
      name:        p.companyName ?? sc.companyName ?? ticker,
      sector:      p.sector      ?? sc.sector ?? '—',
      exchange:    p.exchangeShortName ?? sc.exchangeShortName ?? '—',
      price,
      dayChangePct: poly.todaysChangePerc ?? null,
      marketCap:   p.mktCap ?? sc.marketCap ?? null,
      pe:          r.peRatioTTM              ?? null,
      pb:          r.priceToBookRatioTTM     ?? null,
      evEbitda:    r.enterpriseValueMultipleTTM ?? null,
      dcf:         dcfValue,
      dcfDiscount,
      livePrice:   !!poly.day?.c || !!poly.lastTrade?.p,
    }
  })

  return { stocks: merged, analyzed: tickers.length }
}

// ─── component ────────────────────────────────────────────────────────────────

export default function UndervaluedPage() {
  const [sector,     setSector]     = useState('All Sectors')
  const [exchange,   setExchange]   = useState('all')
  const [capPreset,  setCapPreset]  = useState('large')
  const [maxPE,      setMaxPE]      = useState('')
  const [minDiscount,setMinDiscount]= useState(15)

  const [allStocks,  setAllStocks]  = useState([])
  const [analyzed,   setAnalyzed]   = useState(0)
  const [loading,    setLoading]    = useState(false)
  const [phase,      setPhase]      = useState('')
  const [error,      setError]      = useState(null)
  const [sortKey,    setSortKey]    = useState('dcfDiscount')
  const [sortDir,    setSortDir]    = useState('desc')

  const fetchSeq = useRef(0)

  const runFetch = useCallback(async () => {
    if (!hasFmpKey()) return
    const seq = ++fetchSeq.current
    setLoading(true)
    setError(null)
    setPhase('Screening stocks…')
    try {
      const result = await fetchUndervalued({ sector, exchange, capPreset })
      if (seq !== fetchSeq.current) return
      setAllStocks(result.stocks)
      setAnalyzed(result.analyzed)
    } catch (e) {
      if (seq !== fetchSeq.current) return
      setError(e.message)
    } finally {
      if (seq === fetchSeq.current) { setLoading(false); setPhase('') }
    }
  }, [sector, exchange, capPreset])

  useEffect(() => { runFetch() }, [runFetch])

  // Client-side filter: DCF discount & P/E
  const filtered = allStocks.filter((s) => {
    if (s.dcfDiscount === null || s.dcfDiscount < minDiscount) return false
    const maxPENum = parseFloat(maxPE)
    if (!Number.isNaN(maxPENum) && s.pe !== null) {
      if (s.pe <= 0 || s.pe > maxPENum) return false
    }
    return true
  })

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    let av = a[sortKey], bv = b[sortKey]
    if (av === null || av === undefined) return 1
    if (bv === null || bv === undefined) return -1
    if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    return sortDir === 'asc' ? av - bv : bv - av
  })

  const toggleSort = (key) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('desc') }
  }

  if (!hasFmpKey()) return <MissingKeyBanner />

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100 sm:text-2xl">
            Undervalued US Stocks
          </h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            Fundamentals &amp; DCF via FMP
            {hasPolygonKey() ? ' · Live prices via Polygon' : ' · Add VITE_POLYGON_API_KEY for live prices'}
          </p>
        </div>
        <button
          type="button"
          onClick={runFetch}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"
               className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}>
            <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H3.989a.75.75 0 00-.75.75v4.242a.75.75 0 001.5 0v-2.43l.31.31a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm1.23-3.723a.75.75 0 00.219-.53V2.929a.75.75 0 00-1.5 0V5.36l-.31-.31A7 7 0 003.239 8.188a.75.75 0 101.448.389A5.5 5.5 0 0113.89 6.11l.311.31h-2.432a.75.75 0 000 1.5h4.243a.75.75 0 00.53-.219z" clipRule="evenodd" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Screener filters */}
      <div className="flex flex-wrap gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/50">
        <FilterSelect label="Sector" value={sector} onChange={setSector} options={SECTORS.map((s) => ({ label: s, value: s }))} />
        <FilterSelect
          label="Exchange"
          value={exchange}
          onChange={setExchange}
          options={[
            { label: 'NYSE + NASDAQ', value: 'all' },
            { label: 'NYSE',          value: 'NYSE' },
            { label: 'NASDAQ',        value: 'NASDAQ' },
          ]}
        />
        <FilterSelect
          label="Market Cap"
          value={capPreset}
          onChange={setCapPreset}
          options={CAP_PRESETS.map((c) => ({ label: c.label, value: c.value }))}
        />
        <FilterInput
          label="Max P/E"
          value={maxPE}
          onChange={setMaxPE}
          placeholder="e.g. 20"
          type="number"
          min="0"
          step="1"
        />
        <FilterInput
          label="Min DCF Discount %"
          value={minDiscount}
          onChange={(v) => setMinDiscount(Number(v) || 0)}
          type="number"
          min="0"
          max="100"
          step="5"
        />
      </div>

      {/* Status */}
      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          {phase || 'Loading…'}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm dark:border-rose-900/60 dark:bg-rose-950/40">
          <p className="font-semibold text-rose-900 dark:text-rose-200">API error</p>
          <p className="mt-1 break-words font-mono text-xs text-rose-800 dark:text-rose-300">{error}</p>
        </div>
      )}

      {/* Stats row */}
      {!loading && !error && allStocks.length > 0 && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Analyzed <span className="font-medium text-slate-700 dark:text-slate-300">{analyzed}</span> stocks
          {' · '}
          <span className="font-medium text-slate-700 dark:text-slate-300">{sorted.length}</span> meet criteria
          {!hasPolygonKey() && (
            <span className="ml-2 text-amber-600 dark:text-amber-400">
              (prices from FMP — add Polygon key for live data)
            </span>
          )}
        </p>
      )}

      {/* Table */}
      {!loading && !error && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/50">
              <tr>
                {COLS.map((col) => (
                  <th
                    key={col.key}
                    onClick={() => toggleSort(col.key)}
                    className={`cursor-pointer select-none whitespace-nowrap px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                  >
                    {col.label}
                    {sortKey === col.key && (
                      <span className="ml-1 text-indigo-500">{sortDir === 'asc' ? '▲' : '▼'}</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={COLS.length} className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                    {allStocks.length === 0
                      ? 'Run a screen to find undervalued stocks.'
                      : 'No stocks match the current filters. Try lowering the DCF Discount or raising Max P/E.'}
                  </td>
                </tr>
              ) : (
                sorted.map((s) => <StockRow key={s.symbol} stock={s} />)
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex animate-pulse gap-3 px-4 py-3">
                <div className="h-4 w-14 rounded bg-slate-200 dark:bg-slate-700" />
                <div className="h-4 flex-1 rounded bg-slate-100 dark:bg-slate-800" />
                <div className="h-4 w-20 rounded bg-slate-100 dark:bg-slate-800" />
                <div className="h-4 w-12 rounded bg-slate-100 dark:bg-slate-800" />
                <div className="h-4 w-16 rounded bg-slate-100 dark:bg-slate-800" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── sub-components ───────────────────────────────────────────────────────────

function StockRow({ stock: s }) {
  return (
    <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
      {/* Ticker */}
      <td className="px-3 py-2.5">
        <a
          href={`https://finance.yahoo.com/quote/${s.symbol}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono font-semibold text-indigo-700 hover:underline dark:text-indigo-400"
        >
          {s.symbol}
        </a>
        {s.livePrice && (
          <span className="ml-1.5 rounded-full bg-emerald-100 px-1 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
            live
          </span>
        )}
      </td>
      {/* Company */}
      <td className="max-w-[180px] truncate px-3 py-2.5 text-slate-700 dark:text-slate-300" title={s.name}>
        {s.name}
      </td>
      {/* Sector */}
      <td className="whitespace-nowrap px-3 py-2.5 text-slate-500 dark:text-slate-400">{s.sector}</td>
      {/* Price */}
      <td className="px-3 py-2.5 text-right font-mono text-slate-800 dark:text-slate-200">
        {fmtPrice(s.price)}
      </td>
      {/* Day Chg */}
      <td className={`px-3 py-2.5 text-right font-mono ${dayChangeCls(s.dayChangePct)}`}>
        {fmtPct(s.dayChangePct)}
      </td>
      {/* Market Cap */}
      <td className="px-3 py-2.5 text-right text-slate-600 dark:text-slate-400">
        {fmtCompactUSD(s.marketCap)}
      </td>
      {/* P/E */}
      <td className={`px-3 py-2.5 text-right font-mono ${peBadgeCls(s.pe)}`}>
        {s.pe !== null && s.pe > 0 ? fmtNum(s.pe) : '—'}
      </td>
      {/* P/B */}
      <td className="px-3 py-2.5 text-right font-mono text-slate-600 dark:text-slate-400">
        {s.pb !== null && s.pb > 0 ? fmtNum(s.pb) : '—'}
      </td>
      {/* EV/EBITDA */}
      <td className="px-3 py-2.5 text-right font-mono text-slate-600 dark:text-slate-400">
        {s.evEbitda !== null && s.evEbitda > 0 ? fmtNum(s.evEbitda) : '—'}
      </td>
      {/* DCF Value */}
      <td className="px-3 py-2.5 text-right font-mono text-slate-700 dark:text-slate-300">
        {fmtPrice(s.dcf)}
      </td>
      {/* DCF Discount */}
      <td className="px-3 py-2.5 text-right">
        {s.dcfDiscount !== null && Number.isFinite(s.dcfDiscount) ? (
          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${discountBadgeCls(s.dcfDiscount)}`}>
            {s.dcfDiscount > 0 ? '+' : ''}{fmtNum(s.dcfDiscount)}%
          </span>
        ) : '—'}
      </td>
    </tr>
  )
}

function FilterSelect({ label, value, onChange, options }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  )
}

function FilterInput({ label, value, onChange, ...inputProps }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-28 rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        {...inputProps}
      />
    </label>
  )
}

function MissingKeyBanner() {
  return (
    <div className="max-w-xl rounded-lg border border-amber-200 bg-amber-50 px-5 py-4 dark:border-amber-800/60 dark:bg-amber-950/30">
      <p className="font-semibold text-amber-900 dark:text-amber-200">FMP API key required</p>
      <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
        Create a free account at{' '}
        <span className="font-medium">financialmodelingprep.com</span> to get an API key,
        then add it to the portal environment:
      </p>
      <pre className="mt-3 overflow-x-auto rounded bg-amber-900/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
{`# portal/.env.local
VITE_FMP_API_KEY=your_fmp_key_here

# optional — enables real-time Polygon prices
VITE_POLYGON_API_KEY=your_polygon_key_here`}
      </pre>
      <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
        Restart the dev server after adding the key.
      </p>
    </div>
  )
}
