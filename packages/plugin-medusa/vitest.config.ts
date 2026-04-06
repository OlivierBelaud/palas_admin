import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@manta/core': path.resolve(__dirname, '../core/src/index.ts'),
      '@manta/test-utils': path.resolve(__dirname, '../test-utils/src/index.ts'),
    },
  },
})
