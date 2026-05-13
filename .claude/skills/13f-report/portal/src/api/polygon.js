// In dev: direct calls to Polygon with VITE_POLYGON_API_KEY.
// In prod: calls go to /api/polygon/* — Vercel proxy injects POLYGON_API_KEY server-side.
const BASE = import.meta.env.DEV
  ? 'https://api.polygon.io'
  : '/api/polygon'

function devKey() {
  return import.meta.env.DEV ? (import.meta.env.VITE_POLYGON_API_KEY ?? '') : null
}

export function hasPolygonKey() {
  return import.meta.env.PROD || !!import.meta.env.VITE_POLYGON_API_KEY
}

// Returns { TICKER: snapshotObject, ... }
export async function getSnapshots(tickers) {
  if (!tickers.length) return {}

  const url = new URL(
    `${BASE}/v2/snapshot/locale/us/markets/stocks/tickers`,
    window.location.origin,
  )
  url.searchParams.set('tickers', tickers.join(','))
  const key = devKey()
  if (key) url.searchParams.set('apiKey', key)

  const r = await fetch(url.toString())
  if (!r.ok) throw new Error(`Polygon snapshot: HTTP ${r.status}`)
  const data = await r.json()
  return Object.fromEntries((data.tickers ?? []).map((t) => [t.ticker, t]))
}
