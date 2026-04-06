import { defineConfig } from '@manta/core'

export default defineConfig({
  database: {
    url: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/commerce',
  },
  http: {
    port: 3000,
  },
  plugins: ['@manta/plugin-posthog-proxy'],

  // Override Vercel preset's Upstash/Blob adapters with in-memory alternatives.
  // The Vercel preset auto-selects Upstash Redis (cache, eventbus), Neon locking,
  // and Vercel Blob (files) — all of which require additional env vars / services.
  // For now, use in-memory adapters which work in serverless without external deps.
  // Add Upstash/Blob later when you need persistent cache or file storage.
  adapters: {
    ICachePort: { adapter: '@manta/core/InMemoryCacheAdapter' },
    IEventBusPort: { adapter: '@manta/core/InMemoryEventBusAdapter' },
    ILockingPort: { adapter: '@manta/core/InMemoryLockingAdapter' },
    IFilePort: { adapter: '@manta/core/InMemoryFileAdapter' },
    IJobSchedulerPort: { adapter: '@manta/core/InMemoryJobScheduler' },
  },
})
