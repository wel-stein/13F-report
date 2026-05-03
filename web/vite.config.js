import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { dataDir, publicSite } from './site.config.js'

// publicDir points at the skill's data/ directory so the JSON written by
// download_13f.py is served at the URL root with no copy step.
//
// publicSite is inlined into the bundle as __SITE_CONFIG__ so the UI knows
// title / tagline / source without an extra runtime fetch.
export default defineConfig({
  plugins: [react()],
  publicDir: dataDir,
  base: process.env.VITE_BASE ?? '/',
  define: {
    __SITE_CONFIG__: JSON.stringify(publicSite),
  },
  server: { host: true, port: 5174 },
  preview: { host: true, port: 4174 },
})
