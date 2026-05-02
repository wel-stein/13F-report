import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import adminPlugin from './vite-plugin-admin.js'
import { activeSkill, publicConfig } from './skills.config.js'

// publicDir points at the active skill's `data/` directory so the JSON
// produced by its downloader is served at the URL root with no copy step.
//
// publicConfig(activeSkill) is inlined into the bundle as __PORTAL_CONFIG__
// so the UI knows the title / labels / download command without an extra
// runtime fetch and without bundling Node-only `path`/`url` imports from
// skills.config.js.
//
// The admin plugin registers the dev-only /api/* routes (read/write the
// skill's registry file, proxy SEC search) — production builds ship none of
// that code.
export default defineConfig({
  plugins: [react(), adminPlugin()],
  publicDir: activeSkill.dataDir,
  define: {
    __PORTAL_CONFIG__: JSON.stringify(publicConfig(activeSkill)),
  },
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
})
