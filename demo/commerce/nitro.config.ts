import { existsSync } from 'node:fs'

const adminBuildExists = existsSync('./public/admin')

export default {
  compatibilityDate: '2025-01-01',
  serverDir: '.manta/server',
  publicAssets: adminBuildExists
    ? [{ dir: 'public/admin', baseURL: '/admin' }]
    : [],
  externals: {
    inline: [
      '@manta/core', '@manta/cli', '@manta/adapter-h3',
      '@manta/adapter-database-pg', '@manta/adapter-logger-pino',
      '@manta/host-nitro',
    ],
  },
  // NOTE: do NOT externalize 'zod' or other deps — on Vercel serverless, external
  // packages must be in node_modules at runtime which isn't guaranteed. Let Nitro
  // inline everything. Only externalize native Node.js modules if needed.
}
