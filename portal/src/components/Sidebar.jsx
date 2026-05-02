import { fmtCompactUSD } from '../format.js'
import { portalConfig } from '../config.js'

export default function Sidebar({ filers, selectedCik, onSelect, onManage }) {
  return (
    <aside className="w-72 shrink-0 overflow-y-auto border-r border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-4 py-5">
        <h1 className="text-lg font-semibold text-slate-900">{portalConfig.title}</h1>
        <p className="mt-1 text-xs text-slate-500">{portalConfig.description}</p>
        {onManage && import.meta.env.DEV && (
          <button
            onClick={onManage}
            className="mt-3 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Manage tracked {portalConfig.entityPlural}…
          </button>
        )}
      </div>
      <nav className="py-2">
        {filers.length === 0 && (
          <p className="px-4 py-6 text-sm text-slate-500">
            No data found. Run the downloader to populate{' '}
            <code className="rounded bg-slate-100 px-1">data/</code>.
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
                'block w-full border-l-4 px-4 py-3 text-left transition ' +
                (active
                  ? 'border-indigo-500 bg-indigo-50'
                  : 'border-transparent hover:bg-slate-50')
              }
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-900">{f.name}</span>
                {hasError && (
                  <span className="text-xs text-rose-600" title={f.error}>error</span>
                )}
              </div>
              <div className="mt-0.5 text-xs text-slate-500">
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
