import { readGa4, readGoogleAds } from './provider-google'
import { ReadError, section } from './provider-http'
import { readMeta } from './provider-meta'
import { readPinterest } from './provider-pinterest'
import type { ProviderReadInput, ProviderReadResult } from './types'

type CachedRead = { expires: number; result: Promise<ProviderReadResult> }
const caches = new WeakMap<typeof fetch, Map<string, CachedRead>>()

export async function readProviderEvidence(
  input: ProviderReadInput,
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
): Promise<ProviderReadResult> {
  let cache = caches.get(fetcher)
  if (!cache) {
    cache = new Map()
    caches.set(fetcher, cache)
  }
  // Exact windows only: never reuse a different period. Credential/configuration
  // changes invalidate entries without keeping secret values in cache keys.
  const config = Object.fromEntries(
    Object.entries(env).filter(([key]) => /^(META_|FACEBOOK_|GA4_|GOOGLE_ANALYTICS_|GOOGLE_ADS_|PINTEREST_)/.test(key)),
  )
  const key = createHash('sha256').update(JSON.stringify({ input, config })).digest('hex')
  const existing = cache.get(key)
  if (existing && existing.expires > Date.now()) return existing.result
  cache.delete(key)
  if (cache.size >= 16) cache.delete(cache.keys().next().value!)
  const entry: CachedRead = { expires: Number.POSITIVE_INFINITY, result: readUncached(input, env, fetcher) }
  cache.set(key, entry)
  try {
    return await entry.result
  } finally {
    entry.expires = Date.now() + 15_000
  }
}

async function readUncached(
  input: ProviderReadInput,
  env: NodeJS.ProcessEnv,
  fetcher: typeof fetch,
): Promise<ProviderReadResult> {
  try {
    switch (input.destination) {
      case 'meta_capi':
        return await readMeta(input, env, fetcher)
      case 'google_ads':
        return await readGoogleAds(input, env, fetcher)
      case 'pinterest':
        return await readPinterest(env, fetcher)
      case 'ga4':
        return await readGa4(input, env, fetcher)
    }
  } catch (error) {
    // Provider failure must never take away local evidence. Only static messages
    // created by our read boundary can reach this response.
    const safe =
      error instanceof ReadError
        ? error
        : new ReadError('error', 'Lecture distante indisponible ; le journal CRM reste consultable.')
    return {
      config: { identifiers: [], send_configured: false, current_mode: 'Configuration non déterminée', setup: [] },
      sections: [
        {
          ...section('provider_read', 'Lecture distante', input.destination),
          state: safe.state,
          message: safe.message,
          fetched_at: new Date().toISOString(),
        },
      ],
    }
  }
}

import { createHash } from 'node:crypto'
