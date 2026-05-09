import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Sidebar from './components/Sidebar.jsx'
import StatsCards from './components/StatsCards.jsx'
import HoldingsTable from './components/HoldingsTable.jsx'
import ThemeToggle from './components/ThemeToggle.jsx'
import TopMoves from './components/TopMoves.jsx'
import Overview from './components/Overview.jsx'

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

function readInitialTheme() {
  if (typeof window === 'undefined') return 'light'
  const stored = localStorage.getItem('theme')
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

const VALID_FILTERS = new Set(['all', 'new', 'add', 'trim', 'exit', 'hold'])
const VALID_SORT_KEYS = new Set([
  'issuer', 'cusip', 'shares_prior', 'shares', 'delta_shares',
  'delta_pct', 'value_usd', 'delta_value_usd', 'action',
])
const DEFAULT_SORT = 'value_usd:desc'

function normalizeSort(raw) {
  if (typeof raw !== 'string') return DEFAULT_SORT
  const [k, d] = raw.split(':')
  if (!VALID_SORT_KEYS.has(k)) return DEFAULT_SORT
  if (d !== 'asc' && d !== 'desc') return DEFAULT_SORT
  return `${k}:${d}`
}

function parseHash() {
  const h = (typeof window !== 'undefined' && window.location.hash) || ''
  const params = new URLSearchParams(h.startsWith('#') ? h.slice(1) : h)
  const filter = params.get('filter') ?? 'all'
  return {
    cik:    params.get('cik') ?? '',
    filter: VALID_FILTERS.has(filter) ? filter : 'all',
    sort:   normalizeSort(params.get('sort')),
    q:      params.get('q') ?? '',
  }
}

function writeHash(state) {
  const params = new URLSearchParams()
  if (state.cik) params.set('cik', state.cik)
  // Filter/sort/query only apply to the filer view; strip them on overview
  // so we don't leak stale state across views.
  if (state.cik && state.cik !== 'overview') {
    if (state.filter && state.filter !== 'all') params.set('filter', state.filter)
    if (state.sort   && state.sort   !== DEFAULT_SORT) params.set('sort', state.sort)
    if (state.q) params.set('q', state.q)
  }
  const qs = params.toString()
  const next = qs ? `#${qs}` : ''
  const cur = window.location.hash
  if (cur !== next) {
    const url = next || (window.location.pathname + window.location.search)
    history.replaceState(null, '', url)
  }
}

export default function App() {
  const [summary, setSummary] = useState(null)
  const [summaryError, setSummaryError] = useState(null)
  const [filerCache, setFilerCache] = useState({})
  const [filerError, setFilerError] = useState(null)
  const [loadingFiler, setLoadingFiler] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [theme, setTheme] = useState(readInitialTheme)
  const [hashState, setHashState] = useState(parseHash)

  // Theme: persist + apply class on <html>.
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') root.classList.add('dark')
    else root.classList.remove('dark')
    try { localStorage.setItem('theme', theme) } catch (e) { /* ignore */ }
  }, [theme])

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))

  // Hash <-> state sync.
  useEffect(() => {
    const onHash = () => setHashState(parseHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  useEffect(() => { writeHash(hashState) }, [hashState])

  const updateHash = useCallback((patch) => {
    setHashState((s) => ({ ...s, ...patch }))
  }, [])

  // Drawer: close on Escape, lock body scroll while open, auto-close at md+.
  useEffect(() => {
    if (!sidebarOpen) return
    const onKey = (e) => { if (e.key === 'Escape') setSidebarOpen(false) }
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      document.removeEventListener('keydown', onKey)
    }
  }, [sidebarOpen])
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const onChange = (e) => { if (e.matches) setSidebarOpen(false) }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // Load summary.json once.
  useEffect(() => {
    fetch('/summary.json')
      .then((r) => {
        if (!r.ok) throw new Error(`summary.json: HTTP ${r.status}`)
        return r.json()
      })
      .then((data) => {
        setSummary(data)
        // Default to overview when no cik is in the hash.
        setHashState((s) => (s.cik ? s : { ...s, cik: 'overview' }))
      })
      .catch((e) => setSummaryError(e.message))
  }, [])

  const view = hashState.cik === 'overview' || !hashState.cik ? 'overview' : 'filer'

  const selected = useMemo(() => {
    if (!summary || view !== 'filer') return null
    return summary.filers.find((f) => f.cik === hashState.cik) ?? null
  }, [summary, hashState.cik, view])

  // Cache lookups via ref so fetchFiler stays referentially stable across
  // cache writes (otherwise the prefetch effect re-runs N times as N
  // filers load, walking the whole filer list each pass).
  const filerCacheRef = useRef(filerCache)
  useEffect(() => { filerCacheRef.current = filerCache }, [filerCache])
  const inFlightRef = useRef(new Set())

  const fetchFiler = useCallback((filer) => {
    if (!filer || filer.error) return Promise.resolve(null)
    if (filerCacheRef.current[filer.cik]) return Promise.resolve(filerCacheRef.current[filer.cik])
    if (inFlightRef.current.has(filer.cik)) return Promise.resolve(null)
    inFlightRef.current.add(filer.cik)
    return fetch(`/${slug(filer.name)}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`${slug(filer.name)}.json: HTTP ${r.status}`)
        return r.json()
      })
      .then((data) => {
        setFilerCache((prev) => ({ ...prev, [filer.cik]: data }))
        return data
      })
      .finally(() => { inFlightRef.current.delete(filer.cik) })
  }, [])

  // Single-filer view: load on selection.
  useEffect(() => {
    if (view !== 'filer' || !selected || selected.error) return
    if (filerCache[selected.cik]) return
    setLoadingFiler(true)
    setFilerError(null)
    fetchFiler(selected)
      .catch((e) => setFilerError(e.message))
      .finally(() => setLoadingFiler(false))
  }, [view, selected, filerCache, fetchFiler])

  // Overview view: prefetch every (non-errored) filer JSON. fetchFiler is
  // stable, so this only re-runs when the view or summary actually changes.
  useEffect(() => {
    if (view !== 'overview' || !summary) return
    summary.filers
      .filter((f) => !f.error)
      .forEach((f) => { fetchFiler(f).catch(() => { /* best-effort */ }) })
  }, [view, summary, fetchFiler])

  const filerData = selected && filerCache[selected.cik]
  const overviewFilerData = useMemo(
    () => (summary?.filers ?? []).map((f) => ({ name: f.name, cik: f.cik, data: filerCache[f.cik] ?? null })),
    [summary, filerCache],
  )

  const handleSelect = (cik) => {
    setSidebarOpen(false)
    // No-op when clicking the already-selected filer so we don't wipe the
    // user's filter/sort/query state.
    if (cik === hashState.cik) return
    updateHash({ cik, filter: 'all', sort: DEFAULT_SORT, q: '' })
  }

  const [sortKey, sortDir] = normalizeSort(hashState.sort).split(':')
  const handleTableState = useCallback(({ filter, sortKey, sortDir, query }) => {
    updateHash({ filter, sort: `${sortKey}:${sortDir}`, q: query })
  }, [updateHash])

  return (
    <div className="flex min-h-screen flex-col text-slate-900 dark:text-slate-100 md:h-screen md:flex-row">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900 md:hidden">
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open investor menu"
          className="-ml-1 rounded p-1.5 text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
               className="h-5 w-5">
            <line x1="4" y1="6" x2="20" y2="6" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="18" x2="20" y2="18" />
          </svg>
        </button>
        <p className="text-base font-semibold text-slate-900 dark:text-slate-100">13F Admin Portal</p>
        <ThemeToggle theme={theme} onToggle={toggleTheme} className="ml-auto -mr-1" />
      </header>

      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/40 dark:bg-slate-950/70 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <Sidebar
        filers={summary?.filers ?? []}
        selectedCik={view === 'overview' ? '__overview__' : hashState.cik}
        onSelect={handleSelect}
        onSelectOverview={() => handleSelect('overview')}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        {summaryError && (
          <ErrorBox title="Could not load summary.json" message={summaryError}>
            <p className="mt-2">
              Make sure the data directory has been populated. From the skill folder:
            </p>
            <pre className="mt-2 overflow-x-auto rounded bg-slate-900 px-3 py-2 text-xs text-slate-100 dark:bg-slate-950">
{`# offline (uses bundled fixtures, no network)
python3 download_13f.py --smoke-test

# live (requires network access to data.sec.gov)
python3 download_13f.py --user-agent "Your Name you@example.com"`}
            </pre>
          </ErrorBox>
        )}

        {!summaryError && view === 'overview' && summary && (
          <Overview
            summary={summary}
            filerData={overviewFilerData}
            onSelect={handleSelect}
          />
        )}

        {!summaryError && view === 'filer' && !selected && summary && (
          <p className="text-slate-500 dark:text-slate-400">Investor not found. Pick one from the sidebar.</p>
        )}

        {selected?.error && (
          <ErrorBox title={`${selected.name}: filing error`} message={selected.error} />
        )}

        {view === 'filer' && selected && !selected.error && (
          <>
            <Header filer={selected} generatedAt={summary?.generated_at} />
            {loadingFiler && <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">Loading…</p>}
            {filerError && <ErrorBox title="Could not load filer JSON" message={filerError} />}
            {filerData && (
              <>
                <div className="mt-5">
                  <StatsCards filer={filerData} />
                </div>
                {((filerData.top_buys?.length ?? 0) > 0 || (filerData.top_sells?.length ?? 0) > 0) && (
                  <div className="mt-6">
                    <TopMoves buys={filerData.top_buys} sells={filerData.top_sells} limit={5} />
                  </div>
                )}
                <div className="mt-6">
                  <h2 className="mb-2 text-base font-semibold text-slate-900 dark:text-slate-100">
                    Stock-on-hand vs. prior quarter
                  </h2>
                  <HoldingsTable
                    holdings={filerData.holdings}
                    exited={filerData.exited}
                    filter={hashState.filter}
                    sortKey={sortKey}
                    sortDir={sortDir}
                    query={hashState.q}
                    onChange={handleTableState}
                  />
                </div>
              </>
            )}
          </>
        )}
      </main>
    </div>
  )
}

function Header({ filer, generatedAt }) {
  const latest = filer.latest_filing
  const prior = filer.prior_filing
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100 sm:text-2xl">{filer.name}</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400">CIK {filer.cik}{generatedAt ? ` · generated ${generatedAt}` : ''}</p>
      </div>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        Latest 13F-HR — report&nbsp;
        <span className="font-medium text-slate-900 dark:text-slate-200">{latest?.report_date}</span>
        {' '}(filed {latest?.filing_date})
        {prior && (
          <>
            {' '}·  comparing to <span className="font-medium text-slate-900 dark:text-slate-200">{prior.report_date}</span>
          </>
        )}
      </p>
    </div>
  )
}

function ErrorBox({ title, message, children }) {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 break-words font-mono text-xs">{message}</p>
      {children}
    </div>
  )
}
