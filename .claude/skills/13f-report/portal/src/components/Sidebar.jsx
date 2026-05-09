import { fmtCompactUSD } from '../format.js'
import ThemeToggle from './ThemeToggle.jsx'

export default function Sidebar({
  filers,
  selectedCik,
  onSelect,
  open = false,
  onClose,
  theme,
  onToggleTheme,
}) {
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
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">13F Admin Portal</h1>
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
        {filers.length === 0 && (
          <p className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">
            No filer JSON found. Run the downloader (or smoke test) to populate{' '}
            <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">data/</code>.
          </p>
        )}
        {filers.map((f) => {
          const active = f.cik === selectedCik
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
