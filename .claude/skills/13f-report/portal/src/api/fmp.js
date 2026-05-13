// In dev: direct calls to FMP with VITE_FMP_API_KEY (key stays local, never committed).
// In prod: calls go to /api/fmp/* — the Vercel serverless proxy injects FMP_API_KEY server-side.
const BASE = import.meta.env.DEV
  ? 'https://financialmodelingprep.com/api'
  : '/api/fmp'

function devKey() {
  return import.meta.env.DEV ? (import.meta.env.VITE_FMP_API_KEY ?? '') : null
}

export function hasFmpKey() {
  // In production the serverless proxy handles auth; just check dev key locally.
  return import.meta.env.PROD || !!import.meta.env.VITE_FMP_API_KEY
}

async function fmpFetch(path, params = {}) {
  const url = new URL(`${BASE}/${path}`, window.location.origin)
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== '') url.searchParams.set(k, v)
  }
  const key = devKey()
  if (key) url.searchParams.set('apikey', key)

  const r = await fetch(url.toString())
  if (!r.ok) throw new Error(`FMP ${path}: HTTP ${r.status}`)
  return r.json()
}

export async function screenStocks({ sector, exchange, marketCapMin, marketCapMax, limit = 25 } = {}) {
  return fmpFetch('v3/stock-screener', {
    country: 'US',
    isEtf: 'false',
    isActivelyTrading: 'true',
    limit,
    sector: sector || undefined,
    exchange: exchange || undefined,
    marketCapMoreThan: marketCapMin,
    marketCapLessThan: marketCapMax,
  })
}

export async function getProfiles(tickers) {
  if (!tickers.length) return []
  return fmpFetch(`v3/profile/${tickers.join(',')}`)
}

export async function getRatiosTTM(ticker) {
  const data = await fmpFetch(`v3/ratios-ttm/${ticker}`)
  return Array.isArray(data) ? (data[0] ?? null) : null
}
