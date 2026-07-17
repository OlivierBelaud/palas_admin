import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('catalog taxonomy Vercel packaging', () => {
  const source = readFileSync(new URL('./patch-root-spa-vercel.mjs', import.meta.url), 'utf8')

  it('ships every runtime dependency used by the taxonomy endpoint', () => {
    expect(source).toContain(
      "extraSources: ['catalog-classification-seed.json', 'catalog-shopify-sync.mjs']",
    )
  })

  it('keeps the long-running Shopify reconstruction timeout', () => {
    expect(source).toContain('maxDuration: 300')
    expect(source).toContain('...(maxDuration ? { maxDuration } : {})')
  })
})
