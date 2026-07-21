import { execFileSync } from 'node:child_process'

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const hermeticEnv = {
  PATH: process.env.PATH ?? '',
  HOME: process.env.HOME ?? '',
  CI: process.env.CI ?? '',
  TMPDIR: process.env.TMPDIR ?? '',
  DATABASE_URL: 'postgresql://ci:ci@127.0.0.1:1/ci',
  UPSTASH_REDIS_REST_URL: 'http://127.0.0.1:1',
  UPSTASH_REDIS_REST_TOKEN: 'ci-runtime-token',
  QSTASH_TOKEN: 'ci-qstash-token',
  QSTASH_CURRENT_SIGNING_KEY: 'ci-signing-key',
  QSTASH_NEXT_SIGNING_KEY: 'ci-next-signing-key',
  BLOB_READ_WRITE_TOKEN: 'ci-blob-token',
  RESEND_API_KEY: 're_ci_build_no_delivery',
  SHOPIFY_CATALOG_WRITES_ENABLED: 'false',
  APP_ENV: 'test',
  NODE_ENV: 'production',
}

execFileSync(pnpm, ['--dir', 'demo/commerce', 'build:vercel'], {
  env: hermeticEnv,
  stdio: 'inherit',
})
