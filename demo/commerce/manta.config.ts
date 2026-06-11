// biome-ignore lint/style/noRestrictedImports: manta.config.ts runs before globals are injected
import { defineConfig } from '@mantajs/core'

const upstashKvRestUrl = process.env.UPSTASH_REDIS_KV_REST_API_URL
const upstashKvRestToken = process.env.UPSTASH_REDIS_KV_REST_API_TOKEN

if (!process.env.UPSTASH_REDIS_REST_URL && upstashKvRestUrl) {
  process.env.UPSTASH_REDIS_REST_URL = upstashKvRestUrl
}

if (!process.env.UPSTASH_REDIS_REST_TOKEN && upstashKvRestToken) {
  process.env.UPSTASH_REDIS_REST_TOKEN = upstashKvRestToken
}

const upstashRedisUrl = process.env.UPSTASH_REDIS_REST_URL ?? process.env.UPSTASH_REDIS_KV_REST_API_URL
const upstashRedisToken = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.UPSTASH_REDIS_KV_REST_API_TOKEN
const blobReadWriteToken = process.env.BLOB_READ_WRITE_TOKEN

export default defineConfig({
  database: {
    url: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/commerce',
  },
  http: {
    port: 3000,
  },
  plugins: ['@mantajs/plugin-posthog-proxy'],
  spa: {
    admin: { mountPath: '/' },
  },

  // Production auth needs a durable cache for logout/reset revocation state.
  adapters: {
    ICachePort:
      upstashRedisUrl && upstashRedisToken
        ? {
            adapter: '@mantajs/adapter-cache-upstash',
            options: {
              url: upstashRedisUrl,
              token: upstashRedisToken,
            },
          }
        : { adapter: '@mantajs/core/InMemoryCacheAdapter' },
    IEventBusPort: { adapter: '@mantajs/core/InMemoryEventBusAdapter' },
    ILockingPort: { adapter: '@mantajs/core/InMemoryLockingAdapter' },
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
    INotificationPort: {
      adapter: '@mantajs/adapter-notification-resend',
      options: {
        defaultFrom: process.env.RESEND_FROM_EMAIL ?? 'PALAS <hello@fancypalas.com>',
        defaultReplyTo: process.env.RESEND_REPLY_TO,
      },
    },
  },
})
