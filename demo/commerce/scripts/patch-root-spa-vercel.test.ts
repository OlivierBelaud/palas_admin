import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('catalog taxonomy Vercel packaging', () => {
  const source = readFileSync(new URL('./patch-root-spa-vercel.mjs', import.meta.url), 'utf8')
  const manifest = JSON.parse(
    readFileSync(new URL('../vercel-fast-functions.manifest.json', import.meta.url), 'utf8'),
  ) as {
    functions: Array<{ source: string; extraSources?: string[]; maxDuration?: number }>
  }
  const taxonomy = manifest.functions.find((spec) => spec.source === 'admin-catalog-taxonomy.mjs')

  it('ships every runtime dependency used by the taxonomy endpoint', () => {
    expect(taxonomy?.extraSources).toEqual(['catalog-classification-seed.json', 'catalog-shopify-sync.mjs'])
  })

  it('keeps the long-running Shopify reconstruction timeout', () => {
    expect(taxonomy?.maxDuration).toBe(300)
    expect(source).toContain('...(maxDuration ? { maxDuration } : {})')
  })
})
