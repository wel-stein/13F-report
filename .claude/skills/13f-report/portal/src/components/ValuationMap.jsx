import { useEffect, useMemo, useRef, useState } from 'react'
import { fmtCompactUSD } from '../format.js'
import ThesisCard from './ThesisCard.jsx'

// P/E vs EPS-growth scatter with the PEG = 1 diagonal, for the largest
// companies by combined 13F value (data/valuation.json). P/E uses the
// 13F-implied quarter-end price over TTM diluted EPS; growth is historical
// diluted EPS CAGR — both from SEC data, so this is a trailing PEG.

const TOP_OPTIONS = [25, 50, 100]
const FLOW_THRESHOLD = 2 // % net change in shares held across the cohort

// Diverging flow encoding: blue = net buying, gray = little change, orange = net selling.
const FLOW = {
  buy:  { label: `Net buying (≥ +${FLOW_THRESHOLD}% shares)`, dot: 'fill-[#2a78d6] dark:fill-[#3987e5]' },
  flat: { label: 'Little change', dot: 'fill-[#8a8983] dark:fill-[#77766f]' },
  sell: { label: `Net selling (≤ −${FLOW_THRESHOLD}% shares)`, dot: 'fill-[#eb6834] dark:fill-[#d95926]' },
}

function flowOf(s) {
  const p = s.net_shares_pct
  if (p == null) return 'flat'
  if (p >= FLOW_THRESHOLD) return 'buy'
  if (p <= -FLOW_THRESHOLD) return 'sell'
  return 'flat'
}

const fmtX = (v) => (v == null ? '—' : `${v.toFixed(1)}%`)
const fmtPE = (v) => (v == null ? '—' : `${v.toFixed(1)}×`)
const fmtPEG = (v) => (v == null ? 'n/m' : v.toFixed(2))
const fmtUSD = (v) => (v == null ? '—' : `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
const fmtSignedPct = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`)

function niceStep(span) {
  const raw = span / 6
  return [1, 2, 2.5, 5, 10, 20, 25, 50, 100].find((s) => s >= raw) ?? 100
}

// Upper bound that ignores a lone far outlier (it gets pinned to the edge
// instead of squashing every other point into a corner).
function upperBound(values, floor, cap) {
  const s = [...values].sort((a, b) => a - b)
  const max = s[s.length - 1] ?? floor
  const q90 = s[Math.floor(0.9 * (s.length - 1))] ?? floor
  const hi = max > q90 * 2 ? q90 * 1.3 : max * 1.06
  return Math.min(Math.max(hi, floor), cap)
}

function useWidth(ref) {
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return w
}

function Segmented({ options, value, onChange, label }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</span>
      <div className="inline-flex rounded-md shadow-sm" role="group" aria-label={label}>
        {options.map(([v, text], i) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            aria-pressed={value === v}
            className={
              'px-3 py-1.5 text-xs font-medium ring-1 ring-inset transition ' +
              (i === 0 ? 'rounded-l-md ' : '-ml-px ') +
              (i === options.length - 1 ? 'rounded-r-md ' : '') +
              (value === v
                ? 'z-10 bg-indigo-600 text-white ring-indigo-600'
                : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800')
            }
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  )
}

const M = { top: 14, right: 18, bottom: 46, left: 50 }
const CHAR_W = 6.7 // 11px monospace advance

function Scatter({ points, horizon, onOpen }) {
  const wrapRef = useRef(null)
  const width = useWidth(wrapRef)
  const [hover, setHover] = useState(null)
  const height = Math.round(Math.min(Math.max(width * 0.6, 320), 560))
  const iw = Math.max(width - M.left - M.right, 0)
  const ih = height - M.top - M.bottom

  const geo = useMemo(() => {
    if (!points.length || !iw) return null
    const xs = points.map((p) => p.x)
    const ys = points.map((p) => p.y)
    const xLoRaw = Math.max(Math.min(0, ...xs), -30)
    const xHiRaw = upperBound(xs.filter((v) => v > 0), 30, 150)
    const yHiRaw = upperBound(ys, 30, 150)
    const xStep = niceStep(xHiRaw - xLoRaw)
    const yStep = niceStep(yHiRaw)
    const x0 = Math.floor(xLoRaw / xStep) * xStep
    const x1 = Math.ceil(xHiRaw / xStep) * xStep
    const y1 = Math.ceil(yHiRaw / yStep) * yStep
    const sx = (v) => ((v - x0) / (x1 - x0)) * iw
    const sy = (v) => ih - (v / y1) * ih
    const xTicks = []
    for (let v = x0; v <= x1 + 1e-9; v += xStep) xTicks.push(v)
    const yTicks = []
    for (let v = 0; v <= y1 + 1e-9; v += yStep) yTicks.push(v)

    const placed = points.map((p) => {
      const cx = Math.min(Math.max(p.x, x0), x1)
      const cy = Math.min(Math.max(p.y, 0), y1)
      return { ...p, px: sx(cx), py: sy(cy), pinX: p.x > x1 ? 1 : p.x < x0 ? -1 : 0, pinY: p.y > y1 ? 1 : 0 }
    })

    // Fixed chart annotations, registered first so ticker labels avoid them.
    const e = Math.min(x1, y1)
    const ann = {
      // just under the line, 85% of the way along, so it never sits on the stroke
      peg1: { x: sx(e * 0.85) + 4, y: sy(e * 0.85) + 14 },
      above: { x: sx(0) + 8, y: 16 },
      below: { x: iw - 8, y: ih - 24 },
    }
    // Greedy direct labels: biggest holdings first; a label that would hit a
    // dot, an annotation or another label is dropped (tooltip + table carry it).
    const boxes = [
      ...placed.map((p) => [p.px - 6, p.py - 6, p.px + 6, p.py + 6]),
      [ann.peg1.x, ann.peg1.y - 11, ann.peg1.x + 48, ann.peg1.y + 3],
      [ann.above.x, ann.above.y - 12, ann.above.x + 52, ann.above.y + 3],
      [ann.below.x - 150, ann.below.y - 12, ann.below.x, ih],
      ...(x0 < 0 ? [[0, ih - 22, 84, ih]] : []),
    ]
    const hit = (b) => boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1])
    const labels = new Map()
    for (const p of [...placed].sort((a, b) => b.held_value_usd - a.held_value_usd)) {
      const w = p.ticker.length * CHAR_W
      const cands = [
        { x: p.px + 9, y: p.py + 4, anchor: 'start', box: [p.px + 8, p.py - 6, p.px + 10 + w, p.py + 6] },
        { x: p.px - 9, y: p.py + 4, anchor: 'end', box: [p.px - 10 - w, p.py - 6, p.px - 8, p.py + 6] },
        { x: p.px, y: p.py - 10, anchor: 'middle', box: [p.px - w / 2 - 1, p.py - 20, p.px + w / 2 + 1, p.py - 7] },
        { x: p.px, y: p.py + 18, anchor: 'middle', box: [p.px - w / 2 - 1, p.py + 7, p.px + w / 2 + 1, p.py + 20] },
      ]
      const c = cands.find((k) => k.box[0] >= 0 && k.box[2] <= iw && k.box[1] >= 0 && k.box[3] <= ih && !hit(k.box))
      if (c) {
        boxes.push(c.box)
        labels.set(p.ticker, c)
      }
    }

    // PEG regions (x ≥ 0): the diagonal y = x leaves the box through the top
    // edge or the right edge, whichever comes first.
    const below = [[0, 0], [x1, 0], [x1, Math.min(x1, y1)], ...(x1 > y1 ? [[y1, y1]] : [])]
    const above = [[0, 0], [e, e], ...(x1 < y1 ? [[x1, y1]] : []), [0, y1]]
    const poly = (pts) => pts.map(([a, b]) => `${sx(a)},${sy(b)}`).join(' ')
    return { x0, x1, y1, sx, sy, xTicks, yTicks, placed, labels, e, ann, belowPts: poly(below), abovePts: poly(above) }
  }, [points, iw, ih])

  const tip = hover && geo?.placed.find((p) => p.ticker === hover)

  return (
    <div ref={wrapRef} className="relative w-full" onPointerLeave={() => setHover(null)}>
      {geo && (
        <svg width={width} height={height} role="img" aria-label={`Trailing P/E versus ${horizon} EPS CAGR scatter`} className="block select-none">
          <g transform={`translate(${M.left},${M.top})`}>
            {geo.x0 < 0 && (
              <rect x={0} y={0} width={geo.sx(0)} height={ih} className="fill-slate-500/[0.06] dark:fill-slate-400/[0.06]" />
            )}
            <polygon points={geo.abovePts} className="fill-rose-500/[0.07] dark:fill-rose-400/[0.08]" />
            <polygon points={geo.belowPts} className="fill-emerald-500/[0.08] dark:fill-emerald-400/[0.08]" />

            {geo.yTicks.map((v) => (
              <g key={`y${v}`}>
                <line x1={0} x2={iw} y1={geo.sy(v)} y2={geo.sy(v)} className="stroke-slate-200 dark:stroke-slate-800" strokeWidth={1} />
                <text x={-8} y={geo.sy(v) + 4} textAnchor="end" className="fill-slate-500 text-[11px] tabular-nums dark:fill-slate-400">{v}</text>
              </g>
            ))}
            {geo.xTicks.map((v) => (
              <g key={`x${v}`}>
                <line x1={geo.sx(v)} x2={geo.sx(v)} y1={0} y2={ih} className={v === 0 ? 'stroke-slate-400 dark:stroke-slate-600' : 'stroke-slate-200 dark:stroke-slate-800'} strokeWidth={1} />
                <text x={geo.sx(v)} y={ih + 18} textAnchor="middle" className="fill-slate-500 text-[11px] tabular-nums dark:fill-slate-400">{v}</text>
              </g>
            ))}
            <line x1={0} x2={iw} y1={ih} y2={ih} className="stroke-slate-400 dark:stroke-slate-600" strokeWidth={1} />

            <line x1={geo.sx(0)} y1={geo.sy(0)} x2={geo.sx(geo.e)} y2={geo.sy(geo.e)} className="stroke-emerald-600 dark:stroke-emerald-500" strokeWidth={2} strokeLinecap="round" />
            <text x={geo.ann.peg1.x} y={geo.ann.peg1.y} className="fill-emerald-700 text-[11px] font-semibold dark:fill-emerald-400">PEG = 1</text>
            <text x={geo.ann.above.x} y={geo.ann.above.y} className="fill-slate-500 text-[12px] font-semibold dark:fill-slate-400">PEG &gt; 1</text>
            <text x={geo.ann.below.x} y={geo.ann.below.y} textAnchor="end" className="fill-slate-500 text-[12px] font-semibold dark:fill-slate-400">PEG &lt; 1</text>
            <text x={geo.ann.below.x} y={geo.ann.below.y + 14} textAnchor="end" className="fill-slate-400 text-[10.5px] dark:fill-slate-500">less P/E per unit of growth</text>
            {geo.x0 < 0 && geo.sx(0) > 70 && (
              <text x={6} y={ih - 10} className="fill-slate-400 text-[10.5px] dark:fill-slate-500">EPS shrinking</text>
            )}

            {geo.placed.map((p) => {
              const lab = geo.labels.get(p.ticker)
              const active = hover === p.ticker
              const r = active ? 6.5 : 5
              const pinned = p.pinX || p.pinY
              return (
                <g
                  key={p.ticker}
                  transform={`translate(${p.px},${p.py})`}
                  tabIndex={0}
                  role="button"
                  aria-label={`${p.ticker}: P/E ${fmtPE(p.y)}, EPS CAGR ${fmtX(p.x)}, PEG ${fmtPEG(p.peg)}`}
                  onPointerEnter={() => setHover(p.ticker)}
                  onFocus={() => setHover(p.ticker)}
                  onBlur={() => setHover(null)}
                  onClick={() => onOpen(p)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(p) } }}
                  className="cursor-pointer outline-none"
                >
                  <circle r={13} fill="transparent" />
                  {pinned ? (
                    <path
                      d={p.pinY ? 'M0,-7 L6,4 L-6,4 Z' : p.pinX > 0 ? 'M7,0 L-4,6 L-4,-6 Z' : 'M-7,0 L4,6 L4,-6 Z'}
                      className={`${FLOW[p.flow].dot} stroke-white dark:stroke-slate-900`}
                      strokeWidth={2}
                      strokeLinejoin="round"
                    />
                  ) : (
                    <circle r={r} className={`${FLOW[p.flow].dot} stroke-white dark:stroke-slate-900`} strokeWidth={2} />
                  )}
                  {active && <circle r={r + 3.5} fill="none" className="stroke-slate-900/40 dark:stroke-white/50" strokeWidth={1} />}
                  {lab && (
                    <text
                      x={lab.x - p.px}
                      y={lab.y - p.py}
                      textAnchor={lab.anchor}
                      className={'pointer-events-none font-mono text-[11px] font-semibold ' + (active ? 'fill-slate-900 dark:fill-white' : 'fill-slate-600 dark:fill-slate-300')}
                    >
                      {p.ticker}
                    </text>
                  )}
                </g>
              )
            })}

            <text x={iw / 2} y={ih + 38} textAnchor="middle" className="fill-slate-600 text-[12px] font-medium dark:fill-slate-300">
              Historical {horizon} EPS CAGR (%)
            </text>
            <text transform={`translate(${-38},${ih / 2}) rotate(-90)`} textAnchor="middle" className="fill-slate-600 text-[12px] font-medium dark:fill-slate-300">
              Trailing P/E (×)
            </text>
          </g>
        </svg>
      )}
      {tip && <Tooltip p={tip} horizon={horizon} width={width} />}
    </div>
  )
}

function Tooltip({ p, horizon, width }) {
  const W = 236
  const x = M.left + p.px
  const left = x + 16 + W > width ? Math.max(x - 16 - W, 4) : x + 16
  const top = Math.max(M.top + p.py - 24, 0)
  const Row = ({ label, value, sub }) => (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className="text-right">
        <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">{value}</span>
        {sub && <span className="ml-1 text-[10.5px] text-slate-400 dark:text-slate-500">{sub}</span>}
      </span>
    </div>
  )
  return (
    <div
      className="pointer-events-none absolute z-10 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-800"
      style={{ left, top, width: W }}
    >
      <p className="font-mono text-sm font-bold text-slate-900 dark:text-slate-100">{p.ticker}</p>
      <p className="mb-1.5 truncate text-[11px] text-slate-500 dark:text-slate-400">{p.issuer}</p>
      <div className="space-y-0.5">
        <Row label="PEG" value={fmtPEG(p.peg)} />
        <Row label="Trailing P/E" value={fmtPE(p.y)} sub={p.peDate} />
        <Row label={`EPS CAGR (${horizon})`} value={fmtX(p.x)} />
        <Row label="TTM EPS" value={fmtUSD(p.eps_ttm)} sub={p.eps_ttm_end ? `to ${p.eps_ttm_end}` : null} />
        <Row label="13F price" value={fmtUSD(p.price)} sub="q-end" />
        <Row label="13F holders" value={p.holders} sub={fmtCompactUSD(p.held_value_usd)} />
        <Row label="Net shares Δ" value={fmtSignedPct(p.net_shares_pct)} sub={`${p.buyers}↑ ${p.sellers}↓`} />
      </div>
      <p className="mt-1.5 text-[10.5px] text-slate-400 dark:text-slate-500">Click for thesis card</p>
    </div>
  )
}

const COLUMNS = [
  { key: 'rank', label: '#', num: true, cls: '' },
  { key: 'ticker', label: 'Ticker', cls: '' },
  { key: 'issuer', label: 'Company', cls: 'hidden md:table-cell' },
  { key: 'y', label: 'P/E', num: true, cls: '' },
  { key: 'x', label: 'EPS CAGR', num: true, cls: '' },
  { key: 'peg', label: 'PEG', num: true, cls: '' },
  { key: 'price', label: '13F price', num: true, cls: 'hidden lg:table-cell' },
  { key: 'holders', label: 'Holders', num: true, cls: 'hidden sm:table-cell' },
  { key: 'net_shares_pct', label: 'Net shares Δ', num: true, cls: 'hidden sm:table-cell' },
  { key: 'held_value_usd', label: '13F value', num: true, cls: 'hidden lg:table-cell' },
]

function PointsTable({ points, onOpen }) {
  const [sort, setSort] = useState({ key: 'peg', dir: 'asc' })
  const rows = useMemo(() => {
    const val = (r) => r[sort.key]
    return [...points].sort((a, b) => {
      const va = val(a)
      const vb = val(b)
      if (va == null && vb == null) return 0
      if (va == null) return 1 // n/m always sinks
      if (vb == null) return -1
      const c = typeof va === 'string' ? va.localeCompare(vb) : va - vb
      return sort.dir === 'asc' ? c : -c
    })
  }, [points, sort])
  const toggle = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-100 text-sm dark:divide-slate-800">
        <thead className="bg-slate-50 dark:bg-slate-800/50">
          <tr className="text-slate-700 dark:text-slate-300">
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                scope="col"
                aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                className={`px-3 py-2 font-semibold ${c.num ? 'text-right' : 'text-left'} ${c.cls}`}
              >
                <button type="button" onClick={() => toggle(c.key)} className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white">
                  {c.label}
                  <span className="text-[10px] text-slate-400">{sort.key === c.key ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
          {rows.map((r) => (
            <tr key={r.ticker} onClick={() => onOpen(r)} title="查看个股论点卡" className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50">
              <td className="px-3 py-2 text-right tabular-nums text-slate-400 dark:text-slate-500">{r.rank}</td>
              <td className="px-3 py-2">
                <span className="inline-flex items-center gap-1.5">
                  <svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4" className={FLOW[r.flow].dot} /></svg>
                  <span className="font-mono text-xs font-semibold text-slate-800 dark:text-slate-200">{r.ticker}</span>
                </span>
              </td>
              <td className="hidden max-w-[16rem] truncate px-3 py-2 text-slate-600 dark:text-slate-400 md:table-cell">{r.issuer}</td>
              <td className="px-3 py-2 text-right tabular-nums text-slate-900 dark:text-slate-100">{fmtPE(r.y)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-slate-900 dark:text-slate-100">{fmtX(r.x)}</td>
              <td className="px-3 py-2 text-right">
                <span
                  className={
                    'inline-flex rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums ring-1 ring-inset ' +
                    (r.peg == null
                      ? 'bg-slate-100 text-slate-500 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-400'
                      : r.peg < 1
                        ? 'bg-emerald-100 text-emerald-800 ring-emerald-600/20 dark:bg-emerald-950/60 dark:text-emerald-300 dark:ring-emerald-400/30'
                        : 'bg-rose-50 text-rose-800 ring-rose-600/20 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-400/30')
                  }
                >
                  {fmtPEG(r.peg)}
                </span>
              </td>
              <td className="hidden px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-400 lg:table-cell">{fmtUSD(r.price)}</td>
              <td className="hidden px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-400 sm:table-cell">{r.holders}</td>
              <td className="hidden px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-400 sm:table-cell">{fmtSignedPct(r.net_shares_pct)}</td>
              <td className="hidden px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-400 lg:table-cell">{fmtCompactUSD(r.held_value_usd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function ValuationMap({ valuation, quotes, fundamentals }) {
  const [topN, setTopN] = useState(25)
  const [horizon, setHorizon] = useState('3y')
  const [basis, setBasis] = useState('live')
  const [selected, setSelected] = useState(null)

  // moomoo P/E (latest price / the same SEC EPS) only when newer than the 13F prices.
  const live = quotes?.pe && valuation?.price_date && quotes.as_of > valuation.price_date ? quotes : null
  const useLive = !!live && basis === 'live'

  const growthKey = horizon === '5y' ? 'eps_cagr_5y_pct' : 'eps_cagr_3y_pct'
  const { points, skipped } = useMemo(() => {
    const universe = (valuation?.stocks ?? []).slice(0, topN)
    const points = []
    const skipped = []
    for (const s of universe) {
      const x = s[growthKey]
      const livePE = useLive ? live.pe[s.ticker] : undefined
      const pe = livePE ?? s.pe
      if (pe != null && x != null) {
        const peDate = livePE != null ? live.as_of : valuation.price_date
        points.push({ ...s, x, y: pe, peDate, peg: x > 0 ? pe / x : null, flow: flowOf(s) })
      } else {
        skipped.push({ ticker: s.ticker, reason: s.note ?? `no ${horizon} EPS CAGR (loss in base year or short history)` })
      }
    }
    return { points, skipped }
  }, [valuation, topN, growthKey, horizon, live, useLive])

  const cheap = points.filter((p) => p.peg != null && p.peg < 1).length
  const open = (p) => setSelected({ issuer: p.issuer, ticker: p.ticker, buyerCount: p.buyers, newCount: 0, netBuyUsd: 0 })

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100 sm:text-2xl">Valuation Map · PEG 估值地图</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600 dark:text-slate-400">
          Trailing P/E against historical EPS growth for the largest stocks by combined 13F value. Below the
          diagonal (PEG &lt; 1) you pay less P/E per point of earnings growth. Dot color shows whether the tracked
          filers were net buyers or sellers of the shares this quarter.
          {valuation?.price_date && (
            <span className="text-slate-500">
              {' '}· P/E on {useLive ? `${live.as_of} prices (moomoo)` : `${valuation.price_date} 13F prices`} · generated {valuation.generated_at}
            </span>
          )}
        </p>
      </div>

      {valuation === undefined && <p className="text-sm text-slate-500 dark:text-slate-400">Loading valuation data…</p>}

      {valuation === null && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          <p className="font-semibold">No valuation data yet</p>
          <p className="mt-1">
            <code className="rounded bg-amber-100 px-1 dark:bg-amber-900/50">valuation.json</code> is written by the live
            downloader (the weekly <em>Refresh 13F data</em> workflow, or{' '}
            <code className="rounded bg-amber-100 px-1 dark:bg-amber-900/50">download_13f.py --user-agent …</code>). It needs
            SEC network access, so the offline smoke test doesn't produce it.
          </p>
        </div>
      )}

      {valuation && (
        <>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <Segmented label="Universe" value={topN} onChange={setTopN} options={TOP_OPTIONS.map((n) => [n, `Top ${n}`])} />
            <Segmented label="Growth" value={horizon} onChange={setHorizon} options={[['3y', '3-yr CAGR'], ['5y', '5-yr CAGR']]} />
            {live && (
              <Segmented
                label="P/E price"
                value={basis}
                onChange={setBasis}
                options={[['live', `Latest · ${live.as_of}`], ['13f', `13F q-end · ${valuation.price_date}`]]}
              />
            )}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                P/E vs EPS growth
                <span className="font-normal text-slate-500 dark:text-slate-400"> · {points.length} plotted · {cheap} with PEG &lt; 1</span>
              </h2>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-400" aria-label="Legend">
                {Object.entries(FLOW).map(([k, f]) => (
                  <li key={k} className="inline-flex items-center gap-1.5">
                    <svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4" className={f.dot} /></svg>
                    {f.label}
                  </li>
                ))}
              </ul>
            </div>
            <div className="px-2 py-3 sm:px-4">
              {points.length > 0 ? (
                <Scatter points={points} horizon={horizon} onOpen={open} />
              ) : (
                <p className="px-2 py-10 text-center text-sm text-slate-500 dark:text-slate-400">No stocks in this universe have both a P/E and a {horizon} EPS CAGR.</p>
              )}
            </div>
          </div>

          {points.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Table view <span className="font-normal text-slate-500 dark:text-slate-400">· sorted by PEG, click a row for its thesis card</span>
                </h2>
              </div>
              <PointsTable points={points} onOpen={open} />
            </div>
          )}

          {skipped.length > 0 && (
            <details className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <summary className="cursor-pointer font-semibold text-slate-900 dark:text-slate-100">
                Not plotted <span className="font-normal text-slate-500 dark:text-slate-400">· {skipped.length} of top {topN}</span>
              </summary>
              <ul className="mt-2 grid gap-x-6 gap-y-1 text-xs text-slate-600 dark:text-slate-400 sm:grid-cols-2 lg:grid-cols-3">
                {skipped.map((s) => (
                  <li key={s.ticker}>
                    <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">{s.ticker}</span> — {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <p className="max-w-4xl text-xs text-slate-500 dark:text-slate-400">
            <span className="font-medium">Method.</span> Price = median of 13F value ÷ shares across the {valuation.cohort_filers} filers
            reporting {valuation.price_date}. TTM EPS = trailing-twelve-month diluted EPS from SEC XBRL, checked against stock splits.
            {live && ` “Latest” P/E = the ${live.as_of} moomoo price ÷ that same SEC EPS.`}
            EPS CAGR = annual diluted EPS from 10-K filings, restated across stock splits. This is a <em>trailing</em> PEG
            (Peter Lynch's original form); forward P/E and consensus 3–5-yr growth need analyst estimates, which SEC doesn't
            publish. Foreign 20-F filers (e.g. ASML, TSMC), loss-makers and companies with a loss in the base year are listed
            under “Not plotted”. Not investment advice.
          </p>
        </>
      )}

      {selected && (
        <ThesisCard
          row={selected}
          fundamentals={selected.ticker ? fundamentals?.[selected.ticker] : null}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}
