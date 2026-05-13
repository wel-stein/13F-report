// Serverless proxy — keeps FMP_API_KEY server-side only.
// Forwards GET /api/fmp/<fmp-path>?<params> to financialmodelingprep.com.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')

  const pathParts = req.query.path
  if (!pathParts) return res.status(400).json({ error: 'Missing path' })

  const endpoint = Array.isArray(pathParts) ? pathParts.join('/') : pathParts

  // Reject anything not starting with v3/ or v4/ as a basic safeguard
  if (!/^v[34]\//.test(endpoint)) {
    return res.status(400).json({ error: 'Endpoint not allowed' })
  }

  const url = new URL(`https://financialmodelingprep.com/api/${endpoint}`)
  for (const [k, v] of Object.entries(req.query)) {
    if (k !== 'path') url.searchParams.set(k, v)
  }
  url.searchParams.set('apikey', process.env.FMP_API_KEY ?? '')

  const upstream = await fetch(url.toString())
  const data = await upstream.json()

  // Short cache to reduce FMP quota usage
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60')
  res.status(upstream.status).json(data)
}
