import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['**/*.integration.test.ts'],
    exclude: ['**/node_modules/**', '**/medusa-source/**'],
    testTimeout: 30000,
    env: {
      TEST_DATABASE_URL: 'postgresql://localhost:5432/manta_test_main',
    },
  },
  resolve: {
    alias: {
      '@manta/core/ports': path.resolve(__dirname, './packages/core/src/ports/index.ts'),
      '@manta/core/errors': path.resolve(__dirname, './packages/core/src/errors/manta-error.ts'),
      '@manta/core': path.resolve(__dirname, './packages/core/src/index.ts'),
      '@manta/test-utils/pg': path.resolve(__dirname, './packages/test-utils/src/pg.ts'),
      '@manta/test-utils': path.resolve(__dirname, './packages/test-utils/src/index.ts'),
      '@manta/adapter-logger-pino': path.resolve(__dirname, './packages/adapter-logger-pino/src/index.ts'),
      '@manta/adapter-drizzle-pg': path.resolve(__dirname, './packages/adapter-drizzle-pg/src/index.ts'),
      '@manta/adapter-nitro': path.resolve(__dirname, './packages/adapter-nitro/src/index.ts'),
      '@manta/cli': path.resolve(__dirname, './packages/cli/src/index.ts'),
    },
  },
})
