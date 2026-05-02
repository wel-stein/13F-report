import { useEffect, useState } from 'react'
import { portalConfig } from '../config.js'

const normCik = (cik) => String(parseInt(String(cik), 10))

export default function ManageRegistry({ open, onClose, onChanged }) {
  const [entries, setEntries] = useState([])
  const [listError, setListError] = useState(null)
  const [loadingList, setLoadingList] = useState(false)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(null)
  const [hasSearched, setHasSearched] = useState(false)

  const [busyCik, setBusyCik] = useState(null)
  const [actionError, setActionError] = useState(null)

  const plural = portalConfig.entityPlural
  const singular = portalConfig.entitySingular

  useEffect(() => {
    if (!open) return
    refresh()
    setSearchError(null)
    setActionError(null)
  }, [open])

  async function refresh() {
    setLoadingList(true)
    setListError(null)
    try {
      const r = await fetch('/api/registry')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setEntries(await r.json())
    } catch (e) {
      setListError(String(e.message ?? e))
    } finally {
      setLoadingList(false)
    }
  }

  async function handleSearch(e) {
    e?.preventDefault()
    const q = query.trim()
    if (!q) return
    setSearching(true)
    setSearchError(null)
    setHasSearched(true)
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`)
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`)
      setResults(data.results ?? [])
    } catch (err) {
      setSearchError(String(err.message ?? err))
      setResults([])
    } finally {
      setSearching(false)
    }
  }

  async function handleAdd(item) {
    setBusyCik(item.cik)
    setActionError(null)
    try {
      const r = await fetch('/api/registry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: item.name, cik: item.cik }),
      })
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error ?? `HTTP ${r.status}`)
      }
      await refresh()
      onChanged?.()
    } catch (err) {
      setActionError(`Add failed: ${err.message ?? err}`)
    } finally {
      setBusyCik(null)
    }
  }

  async function handleRemove(item) {
    if (!confirm(`Remove ${item.name} from the tracking list?`)) return
    setBusyCik(item.cik)
    setActionError(null)
    try {
      const r = await fetch(`/api/registry/${normCik(item.cik)}`, { method: 'DELETE' })
      if (!r.ok && r.status !== 204) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error ?? `HTTP ${r.status}`)
      }
      await refresh()
      onChanged?.()
    } catch (err) {
      setActionError(`Remove failed: ${err.message ?? err}`)
    } finally {
      setBusyCik(null)
    }
  }

  if (!open) return null

  const trackedCiks = new Set(entries.map((i) => normCik(i.cik)))

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <h2 className="text-lg font-semibold capitalize text-slate-900">
              Manage Tracked {plural}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Edits are written to the {portalConfig.id} skill's registry file.
              Re-run the downloader to fetch fresh data.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-slate-500 hover:bg-slate-100"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-4">
          {actionError && (
            <p className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {actionError}
            </p>
          )}

          <section>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Currently tracked ({entries.length})
            </h3>
            <div className="divide-y divide-slate-100 rounded border border-slate-200">
              {loadingList && <p className="px-3 py-2 text-sm text-slate-500">Loading…</p>}
              {listError && (
                <p className="px-3 py-2 text-sm text-rose-700">
                  Could not load: {listError}. Are you running <code>npm run dev</code>?
                </p>
              )}
              {!loadingList && !listError && entries.length === 0 && (
                <p className="px-3 py-2 text-sm text-slate-500">None.</p>
              )}
              {entries.map((i) => (
                <div key={normCik(i.cik)} className="flex items-center justify-between px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{i.name}</p>
                    <p className="font-mono text-xs text-slate-500">CIK {i.cik}</p>
                  </div>
                  <button
                    onClick={() => handleRemove(i)}
                    disabled={busyCik === i.cik}
                    className="rounded border border-rose-300 bg-white px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                  >
                    {busyCik === i.cik ? '…' : 'Remove'}
                  </button>
                </div>
              ))}
            </div>
          </section>

          {portalConfig.secSearchEnabled && (
            <section>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                Add from SEC EDGAR
              </h3>
              <form onSubmit={handleSearch} className="flex gap-2">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={`${singular[0].toUpperCase()}${singular.slice(1)} name (e.g. Berkshire, Bridgewater, Renaissance)…`}
                  className="flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <button
                  type="submit"
                  disabled={searching || !query.trim()}
                  className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {searching ? 'Searching…' : 'Search'}
                </button>
              </form>
              <p className="mt-1 text-xs text-slate-500">
                Results are SEC EDGAR full-text search hits filtered by the active skill's form filter.
              </p>

              {searchError && (
                <p className="mt-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                  Search failed: {searchError}
                </p>
              )}

              {!searchError && hasSearched && results.length === 0 && !searching && (
                <p className="mt-3 text-sm text-slate-500">No matches.</p>
              )}

              {results.length > 0 && (
                <div className="mt-3 max-h-72 divide-y divide-slate-100 overflow-y-auto rounded border border-slate-200">
                  {results.map((r) => {
                    const tracked = trackedCiks.has(normCik(r.cik))
                    return (
                      <div
                        key={normCik(r.cik)}
                        className="flex items-center justify-between px-3 py-2"
                      >
                        <div>
                          <p className="text-sm font-medium text-slate-900">{r.name}</p>
                          <p className="font-mono text-xs text-slate-500">CIK {r.cik}</p>
                        </div>
                        <button
                          onClick={() => handleAdd(r)}
                          disabled={tracked || busyCik === r.cik}
                          className={
                            'rounded px-2.5 py-1 text-xs font-medium ' +
                            (tracked
                              ? 'bg-slate-100 text-slate-500'
                              : 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50')
                          }
                        >
                          {tracked ? 'Tracked' : busyCik === r.cik ? '…' : 'Add'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
