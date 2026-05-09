import { useEffect, useMemo, useState } from 'react'
import Sidebar from './components/Sidebar.jsx'
import StatsCards from './components/StatsCards.jsx'
import HoldingsTable from './components/HoldingsTable.jsx'

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

export default function App() {
  const [summary, setSummary] = useState(null)
  const [summaryError, setSummaryError] = useState(null)
  const [selectedCik, setSelectedCik] = useState(null)
  const [filerCache, setFilerCache] = useState({})
  const [filerError, setFilerError] = useState(null)
  const [loadingFiler, setLoadingFiler] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    fetch('/summary.json')
      .then((r) => {
        if (!r.ok) throw new Error(`summary.json: HTTP ${r.status}`)
        return r.json()
      })
      .then((data) => {
        setSummary(data)
        const first = data.filers?.find((f) => !f.error)
        if (first) setSelectedCik(first.cik)
      })
      .catch((e) => setSummaryError(e.message))
  }, [])

  const selected = useMemo(() => {
    if (!summary || !selectedCik) return null
    return summary.filers.find((f) => f.cik === selectedCik) ?? null
  }, [summary, selectedCik])

  useEffect(() => {
    if (!selected || selected.error) return
    if (filerCache[selected.cik]) return
    setLoadingFiler(true)
    setFilerError(null)
    fetch(`/${slug(selected.name)}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`${slug(selected.name)}.json: HTTP ${r.status}`)
        return r.json()
      })
      .then((data) => setFilerCache((prev) => ({ ...prev, [selected.cik]: data })))
      .catch((e) => setFilerError(e.message))
      .finally(() => setLoadingFiler(false))
  }, [selected, filerCache])

  const filerData = selected && filerCache[selected.cik]

  const handleSelect = (cik) => {
    setSelectedCik(cik)
    setSidebarOpen(false)
  }

  return (
    <div className="flex min-h-screen flex-col text-slate-900 md:h-screen md:flex-row">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 md:hidden">
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open investor menu"
          className="-ml-1 rounded p-1.5 text-slate-700 hover:bg-slate-100"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
               className="h-5 w-5">
            <line x1="4" y1="6" x2="20" y2="6" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="18" x2="20" y2="18" />
          </svg>
        </button>
        <h1 className="text-base font-semibold text-slate-900">13F Admin Portal</h1>
      </header>

      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/40 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <Sidebar
        filers={summary?.filers ?? []}
        selectedCik={selectedCik}
        onSelect={handleSelect}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        {summaryError && (
          <ErrorBox title="Could not load summary.json" message={summaryError}>
            <p className="mt-2">
              Make sure the data directory has been populated. From the skill folder:
            </p>
            <pre className="mt-2 overflow-x-auto rounded bg-slate-900 px-3 py-2 text-xs text-slate-100">
{`# offline (uses bundled fixtures, no network)
python3 download_13f.py --smoke-test

# live (requires network access to data.sec.gov)
python3 download_13f.py --user-agent "Your Name you@example.com"`}
            </pre>
          </ErrorBox>
        )}

        {!summaryError && !selected && (
          <p className="text-slate-500">Select an investor on the left.</p>
        )}

        {selected?.error && (
          <ErrorBox title={`${selected.name}: filing error`} message={selected.error} />
        )}

        {selected && !selected.error && (
          <>
            <Header filer={selected} generatedAt={summary.generated_at} />
            {loadingFiler && <p className="mt-4 text-sm text-slate-500">Loading…</p>}
            {filerError && <ErrorBox title="Could not load filer JSON" message={filerError} />}
            {filerData && (
              <>
                <div className="mt-5">
                  <StatsCards filer={filerData} />
                </div>
                <div className="mt-6">
                  <h2 className="mb-2 text-base font-semibold text-slate-900">
                    Stock-on-hand vs. prior quarter
                  </h2>
                  <HoldingsTable holdings={filerData.holdings} exited={filerData.exited} />
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
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{filer.name}</h1>
        <p className="text-xs text-slate-500">CIK {filer.cik} · generated {generatedAt}</p>
      </div>
      <p className="mt-1 text-sm text-slate-600">
        Latest 13F-HR — report&nbsp;
        <span className="font-medium">{latest?.report_date}</span>
        {' '}(filed {latest?.filing_date})
        {prior && (
          <>
            {' '}·  comparing to <span className="font-medium">{prior.report_date}</span>
          </>
        )}
      </p>
    </div>
  )
}

function ErrorBox({ title, message, children }) {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 break-words font-mono text-xs">{message}</p>
      {children}
    </div>
  )
}
