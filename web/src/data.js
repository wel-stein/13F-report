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

/**
 * Per-CUSIP "consensus" — how many distinct funds bought, sold, or held a
 * security this quarter. Differs from aggregateAcrossInvestors, which sorts
 * by dollar magnitude; this is sorted by *agreement among managers*.
 *
 * Returns { buys, sells, totalFilers } where each row is:
 *   { issuer, cusip, class, put_call,
 *     buyers, sellers, holders,                   // arrays of {name, cik, ...}
 *     buyer_count, seller_count, holder_count, coverage,
 *     net,                                        // buyer_count - seller_count
 *     net_dollars }
 */
export function aggregateConsensus(filerResults, { minBuyers = 2, minSellers = 2 } = {}) {
  const bucket = new Map()

  for (const { filer, data } of filerResults) {
    if (!data) continue
    const rows = [...(data.holdings ?? []), ...(data.exited ?? [])]
    for (const h of rows) {
      const key = `${h.cusip}|${h.class}|${h.put_call}`
      let row = bucket.get(key)
      if (!row) {
        row = {
          issuer: h.issuer, cusip: h.cusip, class: h.class, put_call: h.put_call,
          buyers: [], sellers: [], holders: [],
        }
        bucket.set(key, row)
      }
      const ref = {
        name: filer.name, cik: filer.cik, action: h.action,
        delta_shares: h.delta_shares, delta_value_usd: h.delta_value_usd,
        shares: h.shares,
      }
      if (h.action === 'new' || h.action === 'add') row.buyers.push(ref)
      else if (h.action === 'trim' || h.action === 'exit') row.sellers.push(ref)
      else row.holders.push(ref)
    }
  }

  const all = [...bucket.values()].map((r) => {
    const buyer_count  = r.buyers.length
    const seller_count = r.sellers.length
    const holder_count = r.holders.length
    return {
      ...r,
      buyer_count,
      seller_count,
      holder_count,
      coverage: buyer_count + seller_count + holder_count,
      net: buyer_count - seller_count,
      net_dollars:
        r.buyers.reduce((s, b) => s + (b.delta_value_usd || 0), 0) +
        r.sellers.reduce((s, b) => s + (b.delta_value_usd || 0), 0),
    }
  })

  const buys = all
    .filter((r) => r.net > 0 && r.buyer_count >= minBuyers)
    .sort((a, b) => b.net - a.net || b.net_dollars - a.net_dollars)
  const sells = all
    .filter((r) => r.net < 0 && r.seller_count >= minSellers)
    .sort((a, b) => a.net - b.net || a.net_dollars - b.net_dollars)

  const totalFilers = filerResults.filter((r) => r.data).length
  return { buys, sells, totalFilers }
}
