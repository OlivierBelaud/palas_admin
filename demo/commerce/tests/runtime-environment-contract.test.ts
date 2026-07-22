import { describe, expect, it } from 'vitest'
import { assertRuntimeEnvironment } from '../manta.config'

describe('Admin runtime environment contract', () => {
  it.each(['cloudflare', 'edge', 'vercel-edge'])('rejects the unsupported backend target %s', (target) => {
    expect(() => assertRuntimeEnvironment({ MANTA_DEPLOY_PRESET: target })).toThrow(
      /Admin backend edge runtime is unsupported/,
    )
  })

  it('requires durable file storage in distributed production', () => {
    expect(() => assertRuntimeEnvironment({ VERCEL_ENV: 'production' })).toThrow(
      /BLOB_READ_WRITE_TOKEN is required/,
    )
  })

  it('allows the isolated runtime smoke to use its in-memory adapters', () => {
    expect(() =>
      assertRuntimeEnvironment({ VERCEL_ENV: 'production', MANTA_RUNTIME_SMOKE: '1' }),
    ).not.toThrow()
  })

  it('accepts persistent and serverless Node with durable production storage', () => {
    expect(() =>
      assertRuntimeEnvironment({
        MANTA_DEPLOY_PRESET: 'vercel',
        VERCEL_ENV: 'production',
        BLOB_READ_WRITE_TOKEN: 'configured',
      }),
    ).not.toThrow()
  })
})
