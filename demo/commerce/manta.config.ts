import { defineConfig } from '@manta/core'

export default defineConfig({
  database: {
    url: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/commerce',
  },
  http: {
    port: 3000,
  },
  plugins: ['@manta/plugin-posthog-proxy'],

  // All adapters in-memory — no external services needed beyond Neon Postgres.
  adapters: {
    ICachePort: { adapter: '@manta/core/InMemoryCacheAdapter' },
    IEventBusPort: { adapter: '@manta/core/InMemoryEventBusAdapter' },
    ILockingPort: { adapter: '@manta/core/InMemoryLockingAdapter' },
    IFilePort: { adapter: '@manta/core/InMemoryFileAdapter' },
    IJobSchedulerPort: { adapter: '@manta/core/InMemoryJobScheduler' },
  },
})
