import { defineConfig } from '@manta/core'

export default defineConfig({
  database: {
    url: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/commerce',
  },
  http: {
    port: 3000,
  },
  plugins: ['@manta/plugin-posthog-proxy'],

  // Override adapters that need services not yet configured.
  // Upstash Redis (cache + eventbus) is now connected via Vercel integration.
  // Locking, files, and jobs stay in-memory until Vercel Blob / QStash are added.
  adapters: {
    ILockingPort: { adapter: '@manta/core/InMemoryLockingAdapter' },
    IFilePort: { adapter: '@manta/core/InMemoryFileAdapter' },
    IJobSchedulerPort: { adapter: '@manta/core/InMemoryJobScheduler' },
  },
})
