import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Serve the skill's data/ directory directly so /summary.json and
// /<filer-slug>.json resolve to the JSON written by download_13f.py.
export default defineConfig({
  plugins: [react()],
  publicDir: path.resolve(__dirname, '../data'),
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
})
