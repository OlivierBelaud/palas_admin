// biome-ignore lint/style/noRestrictedImports: manta.config.ts runs before globals are injected
import { defineConfig } from '@mantajs/core'

const blobReadWriteToken = process.env.BLOB_READ_WRITE_TOKEN
const upstashRedisUrl =
  process.env.UPSTASH_REDIS_REST_URL ??
  process.env.KV_REST_API_URL ??
  process.env.UPSTASH_REDIS_KV_REST_API_KV_REST_API_URL ??
  process.env.UPSTASH_REDIS_KV_REST_API_UPSTASH_REDIS_REST_URL ??
  process.env.UPSTASH_REDIS_KV_REST_API_URL
const upstashRedisToken =
  process.env.UPSTASH_REDIS_REST_TOKEN ??
  process.env.KV_REST_API_TOKEN ??
  process.env.UPSTASH_REDIS_KV_REST_API_KV_REST_API_TOKEN ??
  process.env.UPSTASH_REDIS_KV_REST_API_UPSTASH_REDIS_REST_TOKEN ??
  process.env.UPSTASH_REDIS_KV_REST_API_TOKEN
const publicBaseUrl =
  process.env.MANTA_BASE_URL ??
  process.env.ADMIN_BASE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://admin.fancypalas.com')
const runtimeSmoke = process.env.MANTA_RUNTIME_SMOKE === '1'

if (!process.env.UPSTASH_REDIS_REST_URL && upstashRedisUrl) {
  process.env.UPSTASH_REDIS_REST_URL = upstashRedisUrl
}

if (!process.env.UPSTASH_REDIS_REST_TOKEN && upstashRedisToken) {
  process.env.UPSTASH_REDIS_REST_TOKEN = upstashRedisToken
}

process.env.MANTA_BASE_URL = publicBaseUrl

export default defineConfig({
  database: {
    url: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/commerce',
  },
  http: {
    port: 3000,
  },
  plugins: ['@mantajs/plugin-posthog-proxy'],
  vercel: {
    envPrefixes: {
      upstashRedis: 'UPSTASH_REDIS_KV_REST_API',
    },
  },
  spa: {
    admin: { mountPath: '/' },
  },

  // Production auth needs a durable cache for logout/reset revocation state.
  adapters: {
    ICachePort: { adapter: '@mantajs/adapter-cache-upstash' },
    IFilePort: blobReadWriteToken
      ? {
          adapter: '@mantajs/adapter-file-vercel-blob',
          options: {
            token: blobReadWriteToken,
            access: 'private',
          },
        }
      : { adapter: '@mantajs/core/InMemoryFileAdapter' },
    // VercelCronAdapter is registry-based: jobs are registered at boot,
    // Vercel Cron triggers them via HTTP at /api/crons/<name> (the
    // framework-owned catch-all wired by wire-cron-routes). The
    // contract is identical to InMemoryJobScheduler — both implement
    // IJobSchedulerPort — so user jobs and the framework reaper job
    // run unchanged.
    IJobSchedulerPort: { adapter: '@mantajs/adapter-jobs-vercel-cron' },
    ...(runtimeSmoke
      ? {}
      : {
          INotificationPort: {
            adapter: '@mantajs/adapter-notification-resend',
            options: {
              defaultFrom: process.env.RESEND_FROM_EMAIL ?? 'PALAS <hello@fancypalas.com>',
              defaultReplyTo: process.env.RESEND_REPLY_TO,
            },
          },
        }),
  },
})
