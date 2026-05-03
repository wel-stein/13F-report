// Configuration for the public-facing 13F site.
//
// Kept tiny on purpose — the public site reads JSON from a single skill's
// `data/` directory and otherwise has no notion of skills. If a future
// version supports multiple skill datasets, this is where the toggle goes.
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const dataDir = path.resolve(
  __dirname,
  '../.claude/skills/13f-report/data',
)

// Public, build-time-inlined site metadata exposed to React via Vite's
// `define`. Safe to expose to the browser — no filesystem paths.
export const publicSite = {
  title: '13F Watch',
  tagline: 'What the largest US institutional investors are buying and selling',
  source: 'SEC Form 13F-HR',
  // GitHub-pages-friendly base; override with VITE_BASE if deploying elsewhere.
  repoUrl: 'https://www.sec.gov/divisions/investment/13ffaq.htm',
}
