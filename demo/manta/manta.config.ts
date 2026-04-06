// Manta project config — single source of truth
// All infrastructure (Vite, Tailwind, Vercel, bootstrap) is handled by the CLI.

import { defineConfig } from '@manta/core'

export default defineConfig({
  database: {
    url: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/manta_demo',
    pool: { min: 2, max: 10 },
  },
  http: { port: 3000 },
  admin: {
    enabled: true,
  },
  plugins: ['@manta/plugin-posthog-proxy'],
})
