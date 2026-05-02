// Vite dev-only middleware that exposes a small admin API for the
// "Manage Tracked Investors" portal module:
//
//   GET    /api/investors            list current entries (investors.json)
//   POST   /api/investors            { name, cik } append, dedup by CIK
//   DELETE /api/investors/:cik       remove by CIK
//   GET    /api/search?q=foo         search SEC EDGAR for 13F-HR filers
//
// Lives under configureServer, so it runs only with `vite` / `vite preview`
// — production builds (`vite build`) ship none of this code.
import fs from 'node:fs/promises'
import path from 'node:path'
import https from 'node:https'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const INVESTORS_PATH = path.resolve(
  __dirname,
  '../.claude/skills/13f-report/investors.json',
)

const SEC_UA = process.env.SEC_UA || '13F-Admin-Portal admin@example.com'

function normalizeCik(cik) {
  // strip leading zeros so "0001067983" and "1067983" compare equal.
  return String(parseInt(String(cik).trim(), 10))
}

async function readInvestors() {
  const txt = await fs.readFile(INVESTORS_PATH, 'utf8')
  return JSON.parse(txt)
}

async function writeInvestors(arr) {
  await fs.writeFile(INVESTORS_PATH, JSON.stringify(arr, null, 2) + '\n', 'utf8')
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve(null)
      try { resolve(JSON.parse(raw)) } catch (e) { reject(e) }
    })
    req.on('error', reject)
  })
}

function fetchSEC(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': SEC_UA, Accept: 'application/json' } }, (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8')
          if (res.statusCode !== 200) {
            return reject(new Error(`SEC ${res.statusCode}: ${body.slice(0, 200)}`))
          }
          try { resolve(JSON.parse(body)) } catch (e) { reject(e) }
        })
      })
      .on('error', reject)
  })
}

function send(res, code, body) {
  res.statusCode = code
  if (body === undefined || body === null) return res.end()
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

async function handleSearch(query) {
  // EDGAR full-text search filtered to 13F-HR filings only — keeps results
  // to entities that actually file 13Fs.
  const url =
    'https://efts.sec.gov/LATEST/search-index' +
    `?q=${encodeURIComponent('"' + query + '"')}` +
    '&forms=13F-HR'
  const data = await fetchSEC(url)
  const seen = new Set()
  const results = []
  for (const hit of data?.hits?.hits ?? []) {
    const ciks = hit?._source?.ciks ?? []
    const names = hit?._source?.display_names ?? []
    for (let i = 0; i < ciks.length; i++) {
      const cik = normalizeCik(ciks[i])
      if (seen.has(cik)) continue
      seen.add(cik)
      // display_names look like "BERKSHIRE HATHAWAY INC  (CIK 0001067983) (Filer)"
      const cleaned = (names[i] ?? '').replace(/\s*\(CIK \d+\).*$/, '').trim()
      results.push({ cik, name: cleaned || `CIK ${cik}` })
      if (results.length >= 25) break
    }
    if (results.length >= 25) break
  }
  return results
}

export default function adminPlugin() {
  return {
    name: '13f-portal-admin',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next()
        try {
          const url = new URL(req.url, 'http://localhost')
          const p = url.pathname

          if (p === '/api/investors' && req.method === 'GET') {
            return send(res, 200, await readInvestors())
          }

          if (p === '/api/investors' && req.method === 'POST') {
            const body = await readJsonBody(req)
            const name = body?.name?.trim?.()
            const rawCik = body?.cik
            if (!name || !rawCik) return send(res, 400, { error: 'name and cik are required' })
            const cik = normalizeCik(rawCik)
            const list = await readInvestors()
            if (list.some((i) => normalizeCik(i.cik) === cik)) {
              return send(res, 409, { error: 'CIK already tracked' })
            }
            const entry = { name, cik }
            list.push(entry)
            await writeInvestors(list)
            return send(res, 201, entry)
          }

          const delMatch = p.match(/^\/api\/investors\/(\d+)$/)
          if (delMatch && req.method === 'DELETE') {
            const target = normalizeCik(delMatch[1])
            const list = await readInvestors()
            const filtered = list.filter((i) => normalizeCik(i.cik) !== target)
            if (filtered.length === list.length) return send(res, 404, { error: 'CIK not tracked' })
            await writeInvestors(filtered)
            return send(res, 204)
          }

          if (p === '/api/search' && req.method === 'GET') {
            const q = url.searchParams.get('q')?.trim()
            if (!q) return send(res, 400, { error: 'q parameter required' })
            const results = await handleSearch(q)
            return send(res, 200, { results })
          }
        } catch (e) {
          return send(res, 500, { error: String(e?.message ?? e) })
        }
        next()
      })
    },
  }
}
