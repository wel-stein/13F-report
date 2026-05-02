import { useEffect, useMemo, useState } from 'react'
import Sidebar from './components/Sidebar.jsx'
import StatsCards from './components/StatsCards.jsx'
import HoldingsTable from './components/HoldingsTable.jsx'
import ManageRegistry from './components/ManageRegistry.jsx'
import { portalConfig } from './config.js'

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
  const [manageOpen, setManageOpen] = useState(false)
  const [pendingDownload, setPendingDownload] = useState(false)

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

  return (
    <div className="flex h-screen text-slate-900">
      <Sidebar
        filers={summary?.filers ?? []}
        selectedCik={selectedCik}
        onSelect={setSelectedCik}
        onManage={() => setManageOpen(true)}
      />
      <ManageRegistry
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        onChanged={() => setPendingDownload(true)}
      />
      <main className="flex-1 overflow-y-auto p-6">
        {pendingDownload && (
          <div className="mb-4 flex items-start gap-3 rounded border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
            <div className="flex-1">
              <p className="font-medium">Tracked {portalConfig.entityPlural} list changed</p>
              <p className="mt-0.5 text-xs">
                Re-run{' '}
                <code className="rounded bg-amber-100 px-1">{portalConfig.downloadCmd}</code>{' '}
                to fetch fresh data, then refresh this page.
              </p>
            </div>
            <button
              onClick={() => setPendingDownload(false)}
              className="text-amber-700 hover:text-amber-900"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        )}
        {summaryError && (
          <ErrorBox title="Could not load summary.json" message={summaryError}>
            <p className="mt-2">
              Make sure the {portalConfig.id} skill's data/ has been populated:
            </p>
            <pre className="mt-2 rounded bg-slate-900 px-3 py-2 text-xs text-slate-100">
              {portalConfig.downloadCmd || '# (no download command configured for this skill)'}
            </pre>
          </ErrorBox>
        )}

        {!summaryError && !selected && (
          <p className="text-slate-500">Select a {portalConfig.entitySingular} on the left.</p>
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
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold text-slate-900">{filer.name}</h1>
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
      <p className="mt-1 font-mono text-xs">{message}</p>
      {children}
    </div>
  )
}
