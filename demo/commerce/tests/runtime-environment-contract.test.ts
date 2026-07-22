import { describe, expect, it } from 'vitest'
import { assertRuntimeEnvironment } from '../manta.config'

describe('Admin runtime environment contract', () => {
  const edgeTargets = [
    'cloudflare',
    'cloudflare_module',
    'cloudflare-module',
    'cloudflare-pages',
    'cloudflare-pages-static',
    'edge',
    'vercel-edge',
  ]

  it.each(['MANTA_DEPLOY_PRESET', 'NITRO_PRESET'] as const)(
    'rejects every unsupported backend target from %s',
    (presetVariable) => {
      for (const target of edgeTargets) {
        expect(() => assertRuntimeEnvironment({ [presetVariable]: target })).toThrow(
          /Admin backend edge runtime is unsupported/,
        )
      }
    },
  )

  it('requires durable file storage in distributed production', () => {
    expect(() => assertRuntimeEnvironment({ VERCEL_ENV: 'production' })).toThrow(
      /BLOB_READ_WRITE_TOKEN is required/,
    )
  })

  it('requires durable file storage in persistent Node production', () => {
    expect(() => assertRuntimeEnvironment({ NODE_ENV: 'production' })).toThrow(
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
    expect(() =>
      assertRuntimeEnvironment({
        NODE_ENV: 'production',
        BLOB_READ_WRITE_TOKEN: 'configured',
      }),
    ).not.toThrow()
  })
})
