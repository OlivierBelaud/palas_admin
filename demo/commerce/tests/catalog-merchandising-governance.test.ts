import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  assertCatalogRemoteAuthority,
  catalogClaimIsAvailable,
  catalogDesiredRevisionIsCurrent,
  catalogFieldOwnership,
  catalogPublicationPolicy,
  catalogSpecFingerprint,
  observeCatalogProvider,
  planCatalogPublication,
  shouldReplayCatalogPublication,
} from '../vercel-fast-functions/catalog-publication-governance.mjs'
import { deleteCatalogMirror, syncCatalogToShopify } from '../vercel-fast-functions/catalog-shopify-sync.mjs'

const SPEC = {
  syncKey: 'category:jewelry',
  categoryId: 'jewelry',
  handle: 'palas-cat-bijoux',
  title: '[PALAS CAT] Bijoux',
  labelFr: 'Bijoux',
  labelEn: 'Jewellery',
  translationStatus: 'complete',
  parentHandle: null,
  position: 0,
  canonicalPath: ['palas-cat-bijoux'],
  directProductIds: ['1', '2'],
  imageUrl: 'https://cdn.example.test/bijoux.jpg',
  productIds: ['1', '2'],
}

describe('catalog merchandising publication governance', () => {
  it('documents field-level ownership at the write boundary', () => {
    expect(catalogFieldOwnership).toMatchObject({
      admin: expect.arrayContaining([
        'collection.title',
        'collection.image',
        'collection.products',
        'collection.product_order',
        'metafields.palas_catalog.*',
      ]),
      shopify: expect.arrayContaining(['product.title', 'product.handle', 'product.media', 'product.publication']),
    })
  })

  it('blocks tests, previews and unarmed production by default', () => {
    expect(
      catalogPublicationPolicy({
        NODE_ENV: 'test',
        SHOPIFY_CATALOG_WRITES_ENABLED: 'true',
      }),
    ).toMatchObject({ allowed: false, runtime: 'test' })
    expect(
      catalogPublicationPolicy({
        VERCEL_ENV: 'preview',
        NODE_ENV: 'production',
        SHOPIFY_CATALOG_WRITES_ENABLED: 'true',
      }),
    ).toMatchObject({ allowed: false, runtime: 'preview' })
    expect(
      catalogPublicationPolicy({
        VERCEL_ENV: 'production',
        NODE_ENV: 'production',
      }),
    ).toMatchObject({ allowed: false, runtime: 'production' })
    expect(
      catalogPublicationPolicy({
        VERCEL_ENV: 'production',
        NODE_ENV: 'production',
        SHOPIFY_CATALOG_WRITES_ENABLED: 'true',
      }),
    ).toEqual({
      allowed: true,
      runtime: 'production',
      target: 'shopify-production',
      reason: null,
    })
  })

  it('checks the safety policy before reading local state or calling Shopify', async () => {
    const sql = vi.fn()
    await expect(
      syncCatalogToShopify(sql, null, {
        env: {
          VERCEL_ENV: 'preview',
          NODE_ENV: 'production',
          SHOPIFY_CATALOG_WRITES_ENABLED: 'true',
        },
      }),
    ).rejects.toThrow(/preview/)
    expect(sql).not.toHaveBeenCalled()
  })

  it('also blocks destructive mirror deletion outside an armed production runtime', async () => {
    const sql = vi.fn()
    await expect(deleteCatalogMirror(sql, 'category-id')).rejects.toThrow(/blocked in test/)
    expect(sql).not.toHaveBeenCalled()
  })

  it('allows only an expired claim to be taken over and replays identical terminal work', () => {
    const now = Date.parse('2026-07-20T12:00:00.000Z')
    expect(catalogClaimIsAvailable({ claim_token: 'owner-a', claim_expires_at: '2026-07-20T12:01:00.000Z' }, now)).toBe(
      false,
    )
    expect(catalogClaimIsAvailable({ claim_token: 'owner-a', claim_expires_at: '2026-07-20T11:59:59.000Z' }, now)).toBe(
      true,
    )

    const mirror = {
      publication_status: 'synced',
      published_fingerprint: 'fingerprint-a',
      shopify_collection_id: 'gid://shopify/Collection/123',
    }
    expect(shouldReplayCatalogPublication(mirror, 'fingerprint-a')).toBe(true)
    expect(shouldReplayCatalogPublication(mirror, 'fingerprint-a', { force: true })).toBe(false)
    expect(shouldReplayCatalogPublication({ ...mirror, publication_status: 'failed' }, 'fingerprint-a')).toBe(false)
    expect(shouldReplayCatalogPublication(mirror, 'fingerprint-b')).toBe(false)
  })

  it('refuses to finalize a publication against a newer canonical revision', () => {
    expect(catalogDesiredRevisionIsCurrent(41, 41)).toBe(true)
    expect(catalogDesiredRevisionIsCurrent(41, 42)).toBe(false)
  })

  it('accepts only the matching PALAS-managed remote and plans deterministic reconciliation', () => {
    const remote = {
      id: 'gid://shopify/Collection/123',
      handle: SPEC.handle,
      managed: true,
      syncKey: SPEC.syncKey,
      productIds: ['gid://shopify/Product/2', 'gid://shopify/Product/1'],
    }

    expect(() => assertCatalogRemoteAuthority(remote, SPEC)).not.toThrow()
    expect(planCatalogPublication(remote, SPEC)).toMatchObject({
      action: 'update',
      authority: 'confirmed',
      reconciliation: {
        add: [],
        remove: [],
        reorder: true,
      },
      desiredFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(catalogSpecFingerprint(SPEC)).toBe(catalogSpecFingerprint({ ...SPEC }))
    expect(catalogSpecFingerprint({ ...SPEC, productIds: ['2', '1'] })).not.toBe(catalogSpecFingerprint(SPEC))
    expect(catalogSpecFingerprint({ ...SPEC, publicationId: 'gid://shopify/Publication/dev' })).not.toBe(
      catalogSpecFingerprint({ ...SPEC, publicationId: 'gid://shopify/Publication/production' }),
    )
  })

  it('rejects a prefixed collection when the durable ownership marker conflicts', () => {
    expect(() =>
      assertCatalogRemoteAuthority(
        {
          id: 'gid://shopify/Collection/123',
          handle: SPEC.handle,
          managed: false,
          syncKey: null,
          productIds: [],
        },
        SPEC,
      ),
    ).toThrow(/authority conflict/i)
    expect(() =>
      assertCatalogRemoteAuthority(
        {
          id: 'gid://shopify/Collection/123',
          handle: SPEC.handle,
          managed: true,
          syncKey: 'category:someone-else',
          productIds: [],
        },
        SPEC,
      ),
    ).toThrow(/authority conflict/i)
  })

  it('keeps local catalog reads available while making a Shopify outage visible', async () => {
    const observation = await observeCatalogProvider(async () => {
      throw new Error('Shopify HTTP 503')
    })

    expect(observation).toEqual({
      ok: false,
      data: [],
      error: 'Shopify HTTP 503',
    })
  })

  it('persists resumable publication evidence without storing credentials', () => {
    const migration = readFileSync(
      'demo/commerce/drizzle/migrations/20260720170000_catalog_publication_governance.sql',
      'utf8',
    )
    const publisher = readFileSync('demo/commerce/vercel-fast-functions/catalog-shopify-sync.mjs', 'utf8')

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS catalog_publication_attempts')
    expect(migration).toContain('desired_fingerprint')
    expect(migration).toContain('published_fingerprint')
    expect(migration).toContain('claim_token')
    expect(migration).toContain('claim_expires_at')
    expect(migration).toContain('catalog_publication_state')
    expect(migration).toContain('desired_revision')
    expect(migration).toContain('retirement_pending')
    expect(migration).toContain("'superseded'")
    expect(publisher).toContain('INSERT INTO catalog_publication_attempts')
    expect(publisher).toContain("publication_status = 'synced'")
    expect(publisher).toContain('CATALOG_PUBLICATION_ERROR_CODES.authorityConflict')
    expect(publisher).toContain('FOR UPDATE')
    expect(publisher).toMatch(
      /const created = await createCollection[\s\S]+findCollection\(config, spec, created\.id\)/,
    )
    expect(publisher).toContain('WHERE retirement_pending = true')
    expect(`${migration}\n${publisher}`).not.toMatch(
      /SHOPIFY_ADMIN_ACCESS_TOKEN.*INSERT|token.*catalog_publication_attempts/i,
    )
  })
})
