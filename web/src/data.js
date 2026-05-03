import { slugFromName } from './format.js'

// All public reads go through here so caching and aggregation live in one
// place.

let summaryCache = null
const filerCache = new Map() // cik → JSON
const historyCache = new Map() // cik → JSON | 'missing'

export async function loadSummary() {
  if (summaryCache) return summaryCache
  const r = await fetch('/summary.json')
  if (!r.ok) throw new Error(`summary.json: HTTP ${r.status}`)
  summaryCache = await r.json()
  return summaryCache
}

export async function loadFiler(filer) {
  if (filer.error) return null
  if (filerCache.has(filer.cik)) return filerCache.get(filer.cik)
  const path = `/${slugFromName(filer.name)}.json`
  const r = await fetch(path)
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`)
  const data = await r.json()
  filerCache.set(filer.cik, data)
  return data
}

/**
 * Load a filer's WhaleCheck history JSON if present, else return null.
 * 404 is an expected outcome (filer has no history file yet) and we cache
 * that result so we don't refetch on every page navigation.
 */
export async function loadFilerHistory(filer) {
  if (filer.error) return null
  const key = String(filer.cik)
  if (historyCache.has(key)) {
    const cached = historyCache.get(key)
    return cached === 'missing' ? null : cached
  }
  const path = `/${slugFromName(filer.name)}_history.json`
  const r = await fetch(path)
  if (r.status === 404) {
    historyCache.set(key, 'missing')
    return null
  }
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`)
  const data = await r.json()
  historyCache.set(key, data)
  return data
}

export async function loadAllFilers(summary) {
  const ok = (summary.filers ?? []).filter((f) => !f.error)
  return Promise.all(ok.map((f) => loadFiler(f).then((data) => ({ filer: f, data }))))
}

/**
 * Aggregate buy/sell activity across all investors.
 * Returns { buys, sells } sorted by net delta_value_usd, where each row is:
 *   { cusip, issuer, class, put_call,
 *     net_delta_shares, net_delta_value_usd,
 *     buyers: [{name, cik, delta_shares, delta_value_usd}],
 *     sellers: [{name, cik, delta_shares, delta_value_usd}] }
 */
export function aggregateAcrossInvestors(filerResults) {
  const bucket = new Map() // key → row
  for (const { filer, data } of filerResults) {
    if (!data) continue
    const everything = [...(data.holdings ?? []), ...(data.exited ?? [])]
    for (const h of everything) {
      if (h.action === 'hold' || h.delta_shares === 0) continue
      const key = `${h.cusip}|${h.class}|${h.put_call}`
      let row = bucket.get(key)
      if (!row) {
        row = {
          cusip: h.cusip,
          issuer: h.issuer,
          class: h.class,
          put_call: h.put_call,
          net_delta_shares: 0,
          net_delta_value_usd: 0,
          buyers: [],
          sellers: [],
        }
        bucket.set(key, row)
      }
      row.net_delta_shares += h.delta_shares
      row.net_delta_value_usd += h.delta_value_usd
      const partial = {
        name: filer.name, cik: filer.cik,
        delta_shares: h.delta_shares,
        delta_value_usd: h.delta_value_usd,
        action: h.action,
      }
      if (h.delta_value_usd > 0) row.buyers.push(partial)
      else if (h.delta_value_usd < 0) row.sellers.push(partial)
    }
  }
  const all = [...bucket.values()]
  const buys  = all
    .filter((r) => r.net_delta_value_usd > 0)
    .sort((a, b) => b.net_delta_value_usd - a.net_delta_value_usd)
  const sells = all
    .filter((r) => r.net_delta_value_usd < 0)
    .sort((a, b) => a.net_delta_value_usd - b.net_delta_value_usd)
  return { buys, sells }
}

/** The "as-of" date for the dataset, taken from the most recent report_date. */
export function asOfQuarter(filerResults) {
  let latest = null
  for (const { data } of filerResults) {
    const d = data?.latest_filing?.report_date
    if (d && (!latest || d > latest)) latest = d
  }
  return latest
}
