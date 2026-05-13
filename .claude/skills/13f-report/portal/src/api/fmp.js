const BASE = 'https://financialmodelingprep.com/api'

function apiKey() {
  return import.meta.env.VITE_FMP_API_KEY ?? ''
}

export function hasFmpKey() {
  return !!import.meta.env.VITE_FMP_API_KEY
}

export async function screenStocks({ sector, exchange, marketCapMin, marketCapMax, limit = 25 } = {}) {
  const p = new URLSearchParams({
    country: 'US',
    isEtf: 'false',
    isActivelyTrading: 'true',
    limit,
    apikey: apiKey(),
  })
  if (sector) p.set('sector', sector)
  if (exchange) p.set('exchange', exchange)
  if (marketCapMin) p.set('marketCapMoreThan', marketCapMin)
  if (marketCapMax) p.set('marketCapLessThan', marketCapMax)
  const r = await fetch(`${BASE}/v3/stock-screener?${p}`)
  if (!r.ok) throw new Error(`FMP screener: HTTP ${r.status}`)
  return r.json()
}

export async function getProfiles(tickers) {
  if (!tickers.length) return []
  const r = await fetch(`${BASE}/v3/profile/${tickers.join(',')}?apikey=${apiKey()}`)
  if (!r.ok) throw new Error(`FMP profiles: HTTP ${r.status}`)
  return r.json()
}

export async function getRatiosTTM(ticker) {
  const r = await fetch(`${BASE}/v3/ratios-ttm/${ticker}?apikey=${apiKey()}`)
  if (!r.ok) throw new Error(`FMP ratios ${ticker}: HTTP ${r.status}`)
  const data = await r.json()
  return Array.isArray(data) ? (data[0] ?? null) : null
}
