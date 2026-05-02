import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Serve the skill's data/ directory directly so /summary.json and
// /<filer-slug>.json resolve to the JSON written by download_13f.py.
// Portal lives at <repo>/portal/; data lives at
// <repo>/.claude/skills/13f-report/data/.
export default defineConfig({
  plugins: [react()],
  publicDir: path.resolve(__dirname, '../.claude/skills/13f-report/data'),
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
})
