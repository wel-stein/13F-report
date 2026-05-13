const BASE = 'https://api.polygon.io'

function apiKey() {
  return import.meta.env.VITE_POLYGON_API_KEY ?? ''
}

export function hasPolygonKey() {
  return !!import.meta.env.VITE_POLYGON_API_KEY
}

// Returns { TICKER: snapshotObject, ... }
export async function getSnapshots(tickers) {
  if (!tickers.length || !apiKey()) return {}
  const p = new URLSearchParams({ tickers: tickers.join(','), apiKey: apiKey() })
  const r = await fetch(`${BASE}/v2/snapshot/locale/us/markets/stocks/tickers?${p}`)
  if (!r.ok) throw new Error(`Polygon snapshot: HTTP ${r.status}`)
  const data = await r.json()
  return Object.fromEntries((data.tickers ?? []).map((t) => [t.ticker, t]))
}
