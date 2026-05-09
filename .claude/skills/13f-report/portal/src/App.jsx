import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Sidebar from './components/Sidebar.jsx'
import StatsCards from './components/StatsCards.jsx'
import HoldingsTable from './components/HoldingsTable.jsx'
import ThemeToggle from './components/ThemeToggle.jsx'
import TopMoves from './components/TopMoves.jsx'
import Overview from './components/Overview.jsx'
import Compare from './components/Compare.jsx'
import CopyLink from './components/CopyLink.jsx'
import PortfolioBar from './components/PortfolioBar.jsx'

function slug(name) {
  // Mirror download_13f.py's slug() exactly: each non-alphanumeric char
  // becomes a single '_' (no collapsing runs), then strip leading/trailing
  // underscores. "FMR (Fidelity)" → "fmr__fidelity" (two underscores from
  // space + open-paren), matching the filename the downloader writes.
  return name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/^_+|_+$/g, '')
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
    a:      params.get('a') ?? '',
    b:      params.get('b') ?? '',
  }
}

function writeHash(state, { push = false } = {}) {
  const params = new URLSearchParams()
  if (state.cik) params.set('cik', state.cik)
  // Filter/sort/query only apply to the filer view; strip them on overview /
  // compare so we don't leak stale state across views.
  if (state.cik && state.cik !== 'overview' && state.cik !== 'compare') {
    if (state.filter && state.filter !== 'all') params.set('filter', state.filter)
    if (state.sort   && state.sort   !== DEFAULT_SORT) params.set('sort', state.sort)
    if (state.q) params.set('q', state.q)
  }
  if (state.cik === 'compare') {
    if (state.a) params.set('a', state.a)
    if (state.b) params.set('b', state.b)
  }
  const qs = params.toString()
  const next = qs ? `#${qs}` : ''
  const cur = window.location.hash
  if (cur !== next) {
    const url = next || (window.location.pathname + window.location.search)
    if (push) history.pushState(null, '', url)
    else history.replaceState(null, '', url)
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
  // Track previous cik so view changes (overview ↔ filer ↔ compare) push
  // a history entry while incidental updates (filter, sort, query, a/b
  // pickers) replace it.
  const prevCikRef = useRef(hashState.cik)
  useEffect(() => {
    const prev = prevCikRef.current
    const cur = hashState.cik
    const cikChanged = prev !== cur
    // Initial '' → 'overview' is a system-driven default-fill, not a user
    // navigation, so don't push it onto history.
    const isInitialDefault = prev === '' && cur === 'overview'
    writeHash(hashState, { push: cikChanged && !isInitialDefault })
    prevCikRef.current = cur
  }, [hashState])

  const updateHash = useCallback((patch) => {
    setHashState((s) => ({ ...s, ...patch }))
  }, [])

  // Drawer: close on Escape, lock body scroll while open, auto-close at md+,
  // and move focus to the close button so keyboard users can dismiss it.
  useEffect(() => {
    if (!sidebarOpen) return
    const onKey = (e) => { if (e.key === 'Escape') setSidebarOpen(false) }
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKey)
    const focusBtn = document.querySelector('[data-drawer-close]')
    focusBtn?.focus?.()
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
        const knownCiks = new Set((data.filers ?? []).map((f) => f.cik))
        // Default to overview, and clear stale a/b/cik values that don't
        // correspond to any filer in the loaded summary.
        setHashState((s) => {
          const isViewSentinel = s.cik === 'overview' || s.cik === 'compare'
          const cikValid = isViewSentinel || !s.cik || knownCiks.has(s.cik)
          return {
            ...s,
            cik: cikValid ? (s.cik || 'overview') : 'overview',
            a: s.a && knownCiks.has(s.a) ? s.a : '',
            b: s.b && knownCiks.has(s.b) ? s.b : '',
          }
        })
      })
      .catch((e) => setSummaryError(e.message))
  }, [])

  const view = !hashState.cik || hashState.cik === 'overview' ? 'overview'
    : hashState.cik === 'compare' ? 'compare'
    : 'filer'

  const selected = useMemo(() => {
    if (!summary || view !== 'filer') return null
    return summary.filers.find((f) => f.cik === hashState.cik) ?? null
  }, [summary, hashState.cik, view])

  // Document title reflects the current view so bookmarks of #cik=... save
  // the filer's name rather than the generic portal title.
  useEffect(() => {
    let t = '13F Admin Portal'
    if (view === 'overview') t = 'Overview · 13F Admin Portal'
    else if (view === 'compare') t = 'Compare · 13F Admin Portal'
    else if (selected) t = `${selected.name} · 13F Admin Portal`
    document.title = t
  }, [view, selected])

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
  const loadSelectedFiler = useCallback(() => {
    if (!selected || selected.error || filerCacheRef.current[selected.cik]) return
    setLoadingFiler(true)
    setFilerError(null)
    fetchFiler(selected)
      .catch((e) => setFilerError(e.message))
      .finally(() => setLoadingFiler(false))
  }, [selected, fetchFiler])
  useEffect(() => {
    if (view !== 'filer') return
    loadSelectedFiler()
  }, [view, loadSelectedFiler])

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
    updateHash({ cik, filter: 'all', sort: DEFAULT_SORT, q: '', a: '', b: '' })
  }

  const handleSelectCompare = () => {
    setSidebarOpen(false)
    if (hashState.cik === 'compare') return
    // Pre-select the first two non-errored filers as a friendly default.
    const ok = (summary?.filers ?? []).filter((f) => !f.error)
    updateHash({
      cik: 'compare',
      filter: 'all', sort: DEFAULT_SORT, q: '',
      a: ok[0]?.cik ?? '',
      b: ok[1]?.cik ?? '',
    })
  }
  const setCompareA = (cik) => updateHash({ a: cik ?? '' })
  const setCompareB = (cik) => updateHash({ b: cik ?? '' })
  const swapCompare = () => updateHash({ a: hashState.b, b: hashState.a })

  // Pre-load compare's selected filers when entering the view directly via
  // a deep-link.
  useEffect(() => {
    if (view !== 'compare' || !summary) return
    for (const cik of [hashState.a, hashState.b]) {
      if (!cik) continue
      const f = summary.filers.find((x) => x.cik === cik)
      if (f) fetchFiler(f).catch(() => {})
    }
  }, [view, summary, hashState.a, hashState.b, fetchFiler])

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
        selectedView={view}
        selectedCik={hashState.cik}
        onSelect={handleSelect}
        onSelectOverview={() => handleSelect('overview')}
        onSelectCompare={handleSelectCompare}
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

        {!summaryError && view === 'compare' && summary && (
          <Compare
            summary={summary}
            filerCache={filerCache}
            fetchFiler={fetchFiler}
            a={hashState.a}
            b={hashState.b}
            onChangeA={setCompareA}
            onChangeB={setCompareB}
            onSwap={swapCompare}
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
            {loadingFiler && <LoadingSkeleton />}
            {filerError && (
              <ErrorBox title="Could not load filer JSON" message={filerError}>
                <button
                  type="button"
                  onClick={() => { setFilerError(null); loadSelectedFiler() }}
                  className="mt-2 rounded border border-rose-300 bg-white px-2 py-1 text-xs font-medium text-rose-800 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200 dark:hover:bg-rose-900/40"
                >
                  Retry
                </button>
              </ErrorBox>
            )}
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
                {(filerData.holdings?.length ?? 0) > 0 && (filerData.total_value_usd ?? 0) > 0 && (
                  <div className="mt-6">
                    <PortfolioBar
                      holdings={filerData.holdings}
                      total={filerData.total_value_usd}
                      top={10}
                    />
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
                    csvBaseName={[slug(selected.name), filerData.latest_filing?.report_date]
                      .filter(Boolean).join('-')}
                    totalValue={filerData.total_value_usd}
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

function edgarFilingUrl(cik, accession) {
  if (!cik || !accession) return null
  const cikNoPad = String(parseInt(cik, 10))
  const accNoDash = accession.replace(/-/g, '')
  return `https://www.sec.gov/Archives/edgar/data/${cikNoPad}/${accNoDash}/`
}

function Header({ filer, generatedAt }) {
  const latest = filer.latest_filing
  const prior = filer.prior_filing
  const edgarUrl = edgarFilingUrl(filer.cik, latest?.accession)
  const isFixture = latest?.accession === 'FIXTURE'
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100 sm:text-2xl">{filer.name}</h1>
        <div className="flex items-center gap-2">
          <CopyLink />
          <p className="text-xs text-slate-500 dark:text-slate-400">CIK {filer.cik}{generatedAt ? ` · generated ${generatedAt}` : ''}</p>
        </div>
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
        {edgarUrl && !isFixture && (
          <>
            {' '}·{' '}
            <a
              href={edgarUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-indigo-700 hover:underline dark:text-indigo-400"
            >
              View on EDGAR ↗
            </a>
          </>
        )}
      </p>
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="mt-4 animate-pulse space-y-3" aria-label="Loading">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-20 rounded-lg border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-800/50" />
        ))}
      </div>
      <div className="h-64 rounded-lg border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-800/50" />
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
