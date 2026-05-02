// Vite dev-only middleware for the admin portal.
//
// The active skill (see skills.config.js) determines which file gets edited
// and which SEC form filter the search uses. The portal currently serves
// one skill at a time; per-skill API namespaces can be layered on later.
//
// Routes:
//   GET    /api/config            sanitized active-skill metadata
//   GET    /api/registry          list current entries (e.g. investors.json)
//   POST   /api/registry          { name, cik } → append, dedup by CIK
//   DELETE /api/registry/:cik     remove by CIK
//   GET    /api/search?q=foo      search SEC EDGAR (if secFormFilter set)
//
// configureServer only runs under `vite` / `vite preview`, so production
// builds (`vite build`) ship none of this code.
import fs from 'node:fs/promises'
import https from 'node:https'
import { activeSkill, publicConfig } from './skills.config.js'

const SEC_UA = process.env.SEC_UA || 'Skill-Admin-Portal admin@example.com'

const normalizeCik = (cik) => String(parseInt(String(cik).trim(), 10))

async function readRegistry() {
  return JSON.parse(await fs.readFile(activeSkill.registryFile, 'utf8'))
}

async function writeRegistry(arr) {
  await fs.writeFile(
    activeSkill.registryFile,
    JSON.stringify(arr, null, 2) + '\n',
    'utf8',
  )
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

async function searchEdgar(query, formFilter) {
  // EDGAR full-text search filtered to the configured form, so results are
  // guaranteed to be entities that actually file it.
  const url =
    'https://efts.sec.gov/LATEST/search-index' +
    `?q=${encodeURIComponent('"' + query + '"')}` +
    `&forms=${encodeURIComponent(formFilter)}`
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
    name: 'skill-admin-portal',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next()
        try {
          const url = new URL(req.url, 'http://localhost')
          const p = url.pathname

          if (p === '/api/config' && req.method === 'GET') {
            return send(res, 200, publicConfig())
          }

          if (p === '/api/registry' && req.method === 'GET') {
            return send(res, 200, await readRegistry())
          }

          if (p === '/api/registry' && req.method === 'POST') {
            const body = await readJsonBody(req)
            const name = body?.name?.trim?.()
            const rawCik = body?.cik
            if (!name || !rawCik) return send(res, 400, { error: 'name and cik are required' })
            const cik = normalizeCik(rawCik)
            const list = await readRegistry()
            if (list.some((i) => normalizeCik(i.cik) === cik)) {
              return send(res, 409, { error: 'CIK already tracked' })
            }
            const entry = { name, cik }
            list.push(entry)
            await writeRegistry(list)
            return send(res, 201, entry)
          }

          const delMatch = p.match(/^\/api\/registry\/(\d+)$/)
          if (delMatch && req.method === 'DELETE') {
            const target = normalizeCik(delMatch[1])
            const list = await readRegistry()
            const filtered = list.filter((i) => normalizeCik(i.cik) !== target)
            if (filtered.length === list.length) return send(res, 404, { error: 'CIK not tracked' })
            await writeRegistry(filtered)
            return send(res, 204)
          }

          if (p === '/api/search' && req.method === 'GET') {
            if (!activeSkill.secFormFilter) {
              return send(res, 404, { error: 'search disabled for this skill' })
            }
            const q = url.searchParams.get('q')?.trim()
            if (!q) return send(res, 400, { error: 'q parameter required' })
            const results = await searchEdgar(q, activeSkill.secFormFilter)
            return send(res, 200, { results })
          }

          // Anything else under /api/* is an unknown endpoint — short-circuit
          // so it doesn't fall through to Vite's SPA HTML fallback.
          return send(res, 404, { error: 'unknown endpoint' })
        } catch (e) {
          return send(res, 500, { error: String(e?.message ?? e) })
        }
      })
    },
  }
}
