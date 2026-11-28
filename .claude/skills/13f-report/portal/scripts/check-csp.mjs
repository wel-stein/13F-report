// Fails the build if an inline <script> in dist/index.html is not covered by a
// sha256 hash in the Content-Security-Policy set in the repo-root vercel.json.
// The policy has no 'unsafe-inline' for scripts, so an unlisted inline script
// would be silently blocked in production.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const portal = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const html = readFileSync(path.join(portal, 'dist/index.html'), 'utf8')
const vercel = JSON.parse(readFileSync(path.resolve(portal, '../../../../vercel.json'), 'utf8'))

const csp = (vercel.headers ?? [])
  .flatMap((h) => h.headers)
  .find((h) => h.key.toLowerCase() === 'content-security-policy')?.value
if (!csp) {
  console.error('check-csp: no Content-Security-Policy header found in vercel.json')
  process.exit(1)
}

const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1])
const missing = inline
  .map((body) => `'sha256-${createHash('sha256').update(body).digest('base64')}'`)
  .filter((hash) => !csp.includes(hash))

if (missing.length) {
  console.error('check-csp: inline script changed; add to script-src in vercel.json:\n  ' + missing.join('\n  '))
  process.exit(1)
}
console.log(`check-csp: ${inline.length} inline script(s) covered by CSP hashes`)
