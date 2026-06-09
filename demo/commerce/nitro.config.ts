import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

const adminBuildExists = existsSync('./public/admin')
const nodeRequire = createRequire(import.meta.url)
const repoRoot = resolve('../..')
const dependencyPaths = [process.cwd(), repoRoot, resolve(repoRoot, 'node_modules/.pnpm/node_modules')]
const nitroDir = dirname(nodeRequire.resolve('nitro/package.json', { paths: dependencyPaths }))

const workspacePackage = (name: string) => {
  const packageName = name.replace('@manta/', '')
  return resolve(repoRoot, 'packages', packageName, 'src', 'index.ts')
}
const dependency = (name: string, paths: string[] = dependencyPaths) => {
  return nodeRequire.resolve(name, { paths })
}

export default {
  compatibilityDate: '2025-01-01',
  serverDir: '.manta/server',
  publicAssets: adminBuildExists ? [{ dir: 'public/admin', baseURL: '/admin' }] : [],
  alias: {
    h3: nodeRequire.resolve('h3/cloudflare', { paths: [nitroDir] }),
    zod: dependency('zod'),
    pino: dependency('pino', [resolve(repoRoot, 'packages/adapter-logger-pino')]),
    resend: dependency('resend'),
    svix: dependency('svix'),
    standardwebhooks: dependency('standardwebhooks'),
    '@stablelib/base64': dependency('@stablelib/base64'),
    'fast-sha256': dependency('fast-sha256'),
    'async-retry': dependency('async-retry'),
    neverthrow: dependency('neverthrow'),
    '@fastify/busboy': dependency('@fastify/busboy'),
    'form-data': dependency('form-data'),
    'combined-stream': dependency('combined-stream'),
    'delayed-stream': dependency('delayed-stream'),
    'mime-types': dependency('mime-types'),
    prismjs: dependency('prismjs'),
    deepmerge: dependency('deepmerge'),
    '@manta/adapter-cache-upstash': workspacePackage('@manta/adapter-cache-upstash'),
    '@manta/adapter-database-neon': workspacePackage('@manta/adapter-database-neon'),
    '@manta/adapter-database-pg': workspacePackage('@manta/adapter-database-pg'),
    '@manta/adapter-eventbus-upstash': workspacePackage('@manta/adapter-eventbus-upstash'),
    '@manta/adapter-file-vercel-blob': workspacePackage('@manta/adapter-file-vercel-blob'),
    '@manta/adapter-h3': workspacePackage('@manta/adapter-h3'),
    '@manta/adapter-jobs-vercel-cron': workspacePackage('@manta/adapter-jobs-vercel-cron'),
    '@manta/adapter-locking-neon': workspacePackage('@manta/adapter-locking-neon'),
    '@manta/adapter-logger-pino': workspacePackage('@manta/adapter-logger-pino'),
    '@manta/adapter-notification-resend': workspacePackage('@manta/adapter-notification-resend'),
    '@manta/adapter-queue-qstash': workspacePackage('@manta/adapter-queue-qstash'),
  },
  externals: {
    inline: [/^@manta\//, 'h3', 'zod'],
  },
  // NOTE: do NOT externalize 'zod' or other deps — on Vercel serverless, external
  // packages must be in node_modules at runtime which isn't guaranteed. Let Nitro
  // inline everything. Only externalize native Node.js modules if needed.
}
