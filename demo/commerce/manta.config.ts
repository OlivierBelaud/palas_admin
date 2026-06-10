// biome-ignore lint/style/noRestrictedImports: manta.config.ts runs before globals are injected
import { defineConfig } from '@mantajs/core'

export default defineConfig({
  database: {
    url: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/commerce',
  },
  http: {
    port: 3000,
  },
  plugins: ['@mantajs/plugin-posthog-proxy'],

  // All adapters in-memory — no external services needed beyond Neon Postgres.
  adapters: {
    ICachePort: { adapter: '@mantajs/core/InMemoryCacheAdapter' },
    IEventBusPort: { adapter: '@mantajs/core/InMemoryEventBusAdapter' },
    ILockingPort: { adapter: '@mantajs/core/InMemoryLockingAdapter' },
    IFilePort: { adapter: '@mantajs/core/InMemoryFileAdapter' },
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
