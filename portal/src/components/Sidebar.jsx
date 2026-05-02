import { fmtCompactUSD } from '../format.js'

export default function Sidebar({ filers, selectedCik, onSelect }) {
  return (
    <aside className="w-72 shrink-0 border-r border-slate-200 bg-white overflow-y-auto">
      <div className="px-4 py-5 border-b border-slate-200">
        <h1 className="text-lg font-semibold text-slate-900">13F Admin Portal</h1>
        <p className="mt-1 text-xs text-slate-500">
          Top US institutional investors — quarterly stock-on-hand vs. prior quarter
        </p>
      </div>
      <nav className="py-2">
        {filers.length === 0 && (
          <p className="px-4 py-6 text-sm text-slate-500">
            No filer JSON found. Run the downloader (or smoke test) to populate{' '}
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
                'block w-full text-left px-4 py-3 border-l-4 transition ' +
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
