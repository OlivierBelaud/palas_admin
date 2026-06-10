import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

const adminBuildExists = existsSync('./public/admin')
const nodeRequire = createRequire(import.meta.url)
const repoRoot = resolve('../..')
const dependencyPaths = [process.cwd(), repoRoot, resolve(repoRoot, 'node_modules/.pnpm/node_modules')]
const nitroDir = dirname(nodeRequire.resolve('nitro/package.json', { paths: dependencyPaths }))

const dependency = (name: string, paths: string[] = dependencyPaths) => {
  return nodeRequire.resolve(name, { paths })
}
const packageRoot = (name: string, paths: string[] = dependencyPaths) => {
  const entry = dependency(name, paths)
  const dir = dirname(entry)
  return dir.endsWith('/dist') || dir.endsWith('/src') ? dirname(dir) : dir
}
const mantaPackage = (name: string) => {
  return dependency(name)
}

export default {
  compatibilityDate: '2025-01-01',
  serverDir: '.manta/server',
  publicAssets: adminBuildExists ? [{ dir: 'public/admin', baseURL: '/admin' }] : [],
  alias: {
    h3: nodeRequire.resolve('h3/cloudflare', { paths: [nitroDir] }),
    zod: dependency('zod'),
    pino: dependency('pino', [packageRoot('@mantajs/adapter-logger-pino')]),
    resend: dependency('resend'),
    svix: dependency('svix'),
    standardwebhooks: dependency('standardwebhooks'),
    '@stablelib/base64': dependency('@stablelib/base64'),
    'fast-sha256': dependency('fast-sha256'),
    'async-retry': dependency('async-retry'),
    neverthrow: dependency('neverthrow'),
    '@fastify/busboy': dependency('@fastify/busboy'),
    prismjs: dependency('prismjs'),
    deepmerge: dependency('deepmerge'),
    '@mantajs/adapter-cache-upstash': mantaPackage('@mantajs/adapter-cache-upstash'),
    '@mantajs/adapter-database-neon': mantaPackage('@mantajs/adapter-database-neon'),
    '@mantajs/adapter-database-pg': mantaPackage('@mantajs/adapter-database-pg'),
    '@mantajs/adapter-eventbus-upstash': mantaPackage('@mantajs/adapter-eventbus-upstash'),
    '@mantajs/adapter-file-vercel-blob': mantaPackage('@mantajs/adapter-file-vercel-blob'),
    '@mantajs/adapter-h3': mantaPackage('@mantajs/adapter-h3'),
    '@mantajs/adapter-jobs-vercel-cron': mantaPackage('@mantajs/adapter-jobs-vercel-cron'),
    '@mantajs/adapter-locking-neon': mantaPackage('@mantajs/adapter-locking-neon'),
    '@mantajs/adapter-logger-pino': mantaPackage('@mantajs/adapter-logger-pino'),
    '@mantajs/adapter-notification-resend': mantaPackage('@mantajs/adapter-notification-resend'),
    '@mantajs/adapter-queue-qstash': mantaPackage('@mantajs/adapter-queue-qstash'),
  },
  externals: {
    inline: [/^@mantajs\//, 'h3', 'zod'],
  },
  // NOTE: do NOT externalize 'zod' or other deps — on Vercel serverless, external
  // packages must be in node_modules at runtime which isn't guaranteed. Let Nitro
  // inline everything. Only externalize native Node.js modules if needed.
}
