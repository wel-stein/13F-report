import { fmtCompactUSD } from '../format.js'

// Tailwind utility classes for the segment colors so we get dark-mode
// flips for free without inline style().
const PALETTE = [
  'bg-indigo-600 dark:bg-indigo-400',
  'bg-violet-500 dark:bg-violet-400',
  'bg-pink-500   dark:bg-pink-400',
  'bg-orange-500 dark:bg-orange-400',
  'bg-amber-500  dark:bg-amber-400',
  'bg-emerald-500 dark:bg-emerald-400',
  'bg-teal-500   dark:bg-teal-400',
  'bg-sky-500    dark:bg-sky-400',
  'bg-fuchsia-500 dark:bg-fuchsia-400',
  'bg-rose-500   dark:bg-rose-400',
]
const OTHER_CLASS = 'bg-slate-300 dark:bg-slate-600'

export default function PortfolioBar({ holdings = [], total = 0, top = 10 }) {
  if (!total || holdings.length === 0) return null
  const sorted = [...holdings].sort((a, b) => (b.value_usd ?? 0) - (a.value_usd ?? 0))
  const head = sorted.slice(0, top)
  const headSum = head.reduce((s, h) => s + (h.value_usd ?? 0), 0)
  const otherSum = Math.max(0, total - headSum)
  const segments = head.map((h, i) => ({
    label: h.issuer,
    value: h.value_usd ?? 0,
    pct: ((h.value_usd ?? 0) / total) * 100,
    cls: PALETTE[i % PALETTE.length],
  }))
  if (otherSum > 0) {
    segments.push({
      label: `Other (${sorted.length - head.length})`,
      value: otherSum,
      pct: (otherSum / total) * 100,
      cls: OTHER_CLASS,
    })
  }
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Portfolio composition</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">Top {head.length} of {sorted.length}</p>
      </div>
      <div className="flex h-3 w-full overflow-hidden rounded ring-1 ring-inset ring-slate-200 dark:ring-slate-800">
        {segments.map((s, i) => (
          <div
            key={i}
            className={s.cls}
            style={{ width: `${s.pct}%` }}
            title={`${s.label}: ${fmtCompactUSD(s.value)} (${s.pct.toFixed(1)}%)`}
          />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-3 lg:grid-cols-5">
        {segments.map((s, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <span className={`inline-block h-2 w-2 shrink-0 rounded-sm ${s.cls}`} aria-hidden="true" />
            <span className="truncate text-slate-700 dark:text-slate-300" title={s.label}>{s.label}</span>
            <span className="ml-auto shrink-0 tabular-nums text-slate-500 dark:text-slate-400">{s.pct.toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
