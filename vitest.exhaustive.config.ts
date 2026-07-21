import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['demo/commerce/**/*.test.{ts,tsx}', 'demo/commerce/**/*.spec.{ts,tsx}'],
    exclude: ['demo/commerce/node_modules/**', 'demo/commerce/.manta/**', 'demo/commerce/.vercel/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      reportsDirectory: 'coverage',
      include: [
        'demo/commerce/src/commands/**/*.{ts,tsx}',
        'demo/commerce/src/emails/**/*.{ts,tsx}',
        'demo/commerce/src/modules/**/*.{ts,tsx}',
        'demo/commerce/src/queries/**/*.{ts,tsx}',
        'demo/commerce/src/subscribers/**/*.{ts,tsx}',
        'demo/commerce/src/utils/**/*.{ts,tsx}',
        'demo/commerce/vercel-fast-functions/*.mjs',
      ],
      exclude: ['**/__tests__/**', '**/*.{test,spec}.{ts,tsx}', '**/*.d.ts'],
      thresholds: {
        lines: 20,
        functions: 20,
        statements: 20,
        branches: 15,
        'demo/commerce/src/commands/**': {
          lines: 20,
          functions: 35,
          statements: 20,
          branches: 30,
        },
        'demo/commerce/src/modules/**': {
          lines: 20,
          functions: 20,
          statements: 20,
          branches: 15,
        },
        'demo/commerce/src/utils/**': {
          lines: 35,
          functions: 30,
          statements: 35,
          branches: 25,
        },
        'demo/commerce/vercel-fast-functions/**': {
          lines: 7,
          functions: 30,
          statements: 7,
          branches: 50,
        },
      },
    },
  },
})
