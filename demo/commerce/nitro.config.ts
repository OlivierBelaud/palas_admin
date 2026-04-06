import { existsSync } from 'node:fs'

const adminBuildExists = existsSync('./public/admin')

export default {
  compatibilityDate: '2025-01-01',
  srcDir: '.manta/server',
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
  rollupConfig: {
    external: ['zod', 'ai', '@ai-sdk/anthropic', '@ai-sdk/openai'],
  },
}
