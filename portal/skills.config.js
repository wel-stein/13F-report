// Registry of skills the admin portal can serve.
//
// The portal is intentionally decoupled from any single skill — it lives at
// the repo root and reads from `<repo>/.claude/skills/<id>/`. This file is
// the only place that names skills; vite.config.js, vite-plugin-admin.js,
// and the UI all read from here.
//
// Today the portal renders ONE active skill at a time (the first registered).
// Multi-skill switching (a UI picker, per-skill API routing) is a future
// iteration; the data shape below is forward-compatible with that.
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const skillsRoot = path.resolve(__dirname, '../.claude/skills')

export const skills = [
  {
    id: '13f-report',

    // UI-facing strings (safe to expose to the browser).
    title: '13F Holdings',
    description:
      'Top US institutional investors — quarterly stock-on-hand vs. prior quarter',
    entitySingular: 'investor',
    entityPlural: 'investors',
    downloadCmd: 'python3 .claude/skills/13f-report/download_13f.py',

    // Server-only filesystem paths (NEVER expose).
    dataDir: path.join(skillsRoot, '13f-report/data'),
    registryFile: path.join(skillsRoot, '13f-report/investors.json'),

    // Optional: SEC EDGAR full-text-search filter for the "Add" flow.
    // Set to null to disable the search UI for skills that don't need it.
    secFormFilter: '13F-HR',
  },
]

export const activeSkill = skills[0]

/** Strip server-only fields for /api/config. */
export function publicConfig(skill = activeSkill) {
  return {
    id: skill.id,
    title: skill.title,
    description: skill.description,
    entitySingular: skill.entitySingular,
    entityPlural: skill.entityPlural,
    downloadCmd: skill.downloadCmd,
    secSearchEnabled: !!skill.secFormFilter,
  }
}
