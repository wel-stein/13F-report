import { useMemo, useState } from 'react'
import { fmtCompactUSD } from '../format.js'
import ThemeToggle from './ThemeToggle.jsx'

export default function Sidebar({
  filers,
  selectedView = 'overview',
  selectedCik,
  onSelect,
  onSelectOverview,
  onSelectCompare,
  open = false,
  onClose,
  theme,
  onToggleTheme,
}) {
  const [filerQuery, setFilerQuery] = useState('')
  const visibleFilers = useMemo(() => {
    const q = filerQuery.trim().toLowerCase()
    if (!q) return filers
    return filers.filter((f) => f.name.toLowerCase().includes(q) || (f.cik || '').includes(q))
  }, [filers, filerQuery])
  const showFilerSearch = filers.length > 8
  return (
    <aside
      className={
        'fixed inset-y-0 left-0 z-40 w-72 max-w-[85vw] shrink-0 transform overflow-y-auto ' +
        'border-r border-slate-200 bg-white transition-transform duration-200 ease-out ' +
        'dark:border-slate-800 dark:bg-slate-900 ' +
        (open ? 'translate-x-0' : '-translate-x-full') + ' ' +
        'md:static md:z-auto md:max-w-none md:translate-x-0'
      }
      aria-label="Investor list"
    >
      <div className="flex items-start justify-between gap-2 border-b border-slate-200 px-4 py-5 dark:border-slate-800">
        <div>
          <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">13F Admin Portal</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Top US institutional investors — quarterly stock-on-hand vs. prior quarter
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onToggleTheme && (
            <ThemeToggle theme={theme} onToggle={onToggleTheme} className="hidden md:inline-flex" />
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            data-drawer-close
            className="-mr-1 rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 md:hidden"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                 className="h-5 w-5">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>
      </div>
      <nav className="py-2">
        {(onSelectOverview || onSelectCompare) && (
          <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Aggregate
          </p>
        )}
        {onSelectOverview && (
          <button
            onClick={onSelectOverview}
            className={
              'block w-full text-left px-4 py-3 border-l-4 transition ' +
              (selectedView === 'overview'
                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40'
                : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/60')
            }
          >
            <span className="text-sm font-medium text-slate-900 dark:text-slate-100">Overview</span>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Aggregated across all filers</p>
          </button>
        )}
        {onSelectCompare && (
          <button
            onClick={onSelectCompare}
            className={
              'block w-full text-left px-4 py-3 border-l-4 transition ' +
              (selectedView === 'compare'
                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40'
                : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/60')
            }
          >
            <span className="text-sm font-medium text-slate-900 dark:text-slate-100">Compare filers</span>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Pick two filers to diff</p>
          </button>
        )}
        {(onSelectOverview || onSelectCompare) && filers.length > 0 && (
          <>
            <div className="my-2 border-t border-slate-200 dark:border-slate-800" aria-hidden="true" />
            <p className="px-4 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Filers
            </p>
          </>
        )}
        {showFilerSearch && (
          <div className="px-4 pb-2 pt-1">
            <input
              type="search"
              value={filerQuery}
              onChange={(e) => setFilerQuery(e.target.value)}
              placeholder="Search filers…"
              aria-label="Search filers"
              className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
          </div>
        )}
        {filers.length === 0 && (
          <p className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">
            No filer JSON found. Run the downloader (or smoke test) to populate{' '}
            <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">data/</code>.
          </p>
        )}
        {showFilerSearch && visibleFilers.length === 0 && (
          <p className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">No filers match “{filerQuery}”.</p>
        )}
        {visibleFilers.map((f) => {
          const active = selectedView === 'filer' && f.cik === selectedCik
          const hasError = !!f.error
          return (
            <button
              key={f.cik}
              onClick={() => onSelect(f.cik)}
              className={
                'block w-full text-left px-4 py-3 border-l-4 transition ' +
                (active
                  ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40'
                  : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/60')
              }
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{f.name}</span>
                {hasError && (
                  <span className="text-xs text-rose-600 dark:text-rose-400" title={f.error}>error</span>
                )}
              </div>
              <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {hasError
                  ? 'No data'
                  : `${f.holdings_count?.toLocaleString() ?? '—'} holdings · ${fmtCompactUSD(f.total_value_usd)}`}
              </div>
            </button>
          )
        })}
      </nav>
    </aside>
  )
}
