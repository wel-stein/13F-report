// __PORTAL_CONFIG__ is inlined at build time by Vite's `define`.
// See portal/vite.config.js and portal/skills.config.js.
/* global __PORTAL_CONFIG__ */
export const portalConfig =
  typeof __PORTAL_CONFIG__ !== 'undefined'
    ? __PORTAL_CONFIG__
    : {
        id: 'unknown',
        title: 'Skill Admin Portal',
        description: '',
        entitySingular: 'entry',
        entityPlural: 'entries',
        downloadCmd: '',
        secSearchEnabled: false,
      }
