import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
// @ts-ignore — nitro/config resolved at runtime by nitro
import { defineNitroConfig } from 'nitro/config'

const adminBuildExists = existsSync(resolve('public/admin'))

export default defineNitroConfig({
  compatibilityDate: '2026-03-18',
  scanDirs: ['.manta/server'],
  devServer: {
    port: 3000,
  },
  // Admin dashboard — dev: proxy to Vite, prod: static from public/admin/
  devProxy: {
    '/admin/**': 'http://localhost:5199',
    '/admin/': 'http://localhost:5199',
    '/@vite/**': 'http://localhost:5199',
    '/@fs/**': 'http://localhost:5199',
    '/node_modules/.vite/**': 'http://localhost:5199',
  },
  // Only add publicAssets if the build output exists (after manta build)
  publicAssets: adminBuildExists
    ? [{ dir: 'public/admin', baseURL: '/admin' }]
    : [],
  externals: {
    inline: [],
    external: [
      '@manta/core', '@manta/cli',
      '@manta/adapter-database-pg', '@manta/adapter-logger-pino',
      '@manta/adapter-h3', '@manta/host-nitro',
      'postgres', 'drizzle-orm', 'drizzle-orm/postgres-js',
      'awilix', 'pino', 'pino-pretty', 'jiti',
      'ai', '@ai-sdk/anthropic', '@ai-sdk/openai', '@ai-sdk/google', '@ai-sdk/mistral',
    ],
  },
})
