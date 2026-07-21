import { defineConfig, devices } from '@playwright/test'

const authState = 'tests/runtime/.auth.json'

export default defineConfig({
  testDir: 'tests/runtime',
  testMatch: '**/*.spec.ts',
  globalSetup: './tests/runtime/global-setup.ts',
  globalTeardown: './tests/runtime/global-teardown.ts',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  timeout: 60_000,
  use: {
    baseURL: process.env.MANTA_RUNTIME_BASE_URL ?? 'http://localhost:19500',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'auth-setup', testMatch: '**/auth.setup.ts' },
    {
      name: 'chromium',
      testIgnore: '**/auth.setup.ts',
      dependencies: ['auth-setup'],
      use: { ...devices['Desktop Chrome'], storageState: authState },
    },
  ],
})
