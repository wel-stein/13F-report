// Number / currency formatting helpers shared across the public site.

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 })
const integer = new Intl.NumberFormat('en-US')

export function fmtCompactUSD(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  const sign = n < 0 ? '-' : ''
  return `${sign}$${compact.format(Math.abs(n))}`
}

export function fmtSignedUSD(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  const sign = n > 0 ? '+' : n < 0 ? '-' : ''
  return `${sign}$${compact.format(Math.abs(n))}`
}

export function fmtShares(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return integer.format(n)
}

export function fmtSignedShares(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  const sign = n > 0 ? '+' : ''
  return sign + integer.format(n)
}

export function fmtPct(curr, prev) {
  if (!prev) return curr ? 'new' : '—'
  const pct = ((curr - prev) / prev) * 100
  const sign = pct > 0 ? '+' : ''
  return `${sign}${pct.toFixed(1)}%`
}

export function slugFromName(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

export const ACTION_BADGE = {
  new:  'bg-emerald-100 text-emerald-800 ring-emerald-600/20',
  add:  'bg-green-100   text-green-800   ring-green-600/20',
  hold: 'bg-slate-100   text-slate-700   ring-slate-500/20',
  trim: 'bg-amber-100   text-amber-800   ring-amber-600/20',
  exit: 'bg-rose-100    text-rose-800    ring-rose-600/20',
}
