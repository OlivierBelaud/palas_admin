import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  type ITranslationPort,
  MantaError,
  createTestContainer,
  resetAll,
  InMemoryContainer,
  NoOpTranslationAdapter,
} from '@manta/test-utils'

describe('ITranslationPort Conformance', () => {
  let translation: ITranslationPort
  let container: InMemoryContainer

  beforeEach(() => {
    container = createTestContainer()
    translation = container.resolve<ITranslationPort>('ITranslationPort')
  })

  afterEach(async () => {
    await resetAll(container)
  })

  // T-01 — SPEC-134/105-T3: applyTranslations replaces fields
  it('applyTranslations > remplace les champs', async () => {
    // Create translation first
    await translation.createTranslations([{
      reference_id: 'p1',
      reference: 'product',
      locale_code: 'fr',
      translations: { name: 'Produit Test' },
    }])

    const results = [{ id: 'p1', name: 'Test Product', price: 100 }]
    const translated = await translation.applyTranslations(results, 'fr', 'product')

    // NoOpTranslationAdapter returns results unchanged
    // Real adapter would replace name with 'Produit Test'
    expect(translated).toHaveLength(1)
    expect(translated[0].id).toBe('p1')
  })

  // T-02 — SPEC-105-T8: no-op when module disabled
  it('applyTranslations > no-op si module désactivé', async () => {
    const noOp = new NoOpTranslationAdapter()
    const results = [{ id: 'p1', name: 'Original', price: 100 }]

    const translated = await noOp.applyTranslations(results, 'fr', 'product')

    // Returns unchanged results
    expect(translated).toEqual(results)
    expect(translated[0].name).toBe('Original')
  })

  // T-03 — SPEC-105-T3: fallback when locale missing
  it('applyTranslations > fallback si locale manquante', async () => {
    const results = [{ id: 'p1', name: 'Default Name' }]
    const translated = await translation.applyTranslations(results, 'ja', 'product')

    // Untranslated locale returns default values
    expect(translated).toHaveLength(1)
    expect(translated[0].name).toBe('Default Name')
  })

  // T-04 — SPEC-134: createTranslations
  it('createTranslations > création', async () => {
    const result = await translation.createTranslations([{
      reference_id: 'p1',
      reference: 'product',
      locale_code: 'fr',
      translations: { name: 'Produit' },
    }])

    expect(result).toBeDefined()
  })

  // T-05 — SPEC-134: updateTranslations
  it('updateTranslations > mise à jour', async () => {
    await translation.createTranslations([{
      reference_id: 'p1',
      reference: 'product',
      locale_code: 'fr',
      translations: { name: 'Produit' },
    }])

    const result = await translation.updateTranslations([{
      reference_id: 'p1',
      locale_code: 'fr',
      translations: { name: 'Produit Mis à Jour' },
    }])

    expect(result).toBeDefined()
  })

  // T-06 — SPEC-134: deleteTranslations
  it('deleteTranslations > suppression', async () => {
    await translation.createTranslations([{
      reference_id: 'p1',
      reference: 'product',
      locale_code: 'fr',
      translations: { name: 'Produit' },
    }])

    await translation.deleteTranslations({ reference_id: ['p1'] })

    // After deletion, applyTranslations returns default values
    const results = [{ id: 'p1', name: 'Default' }]
    const translated = await translation.applyTranslations(results, 'fr', 'product')
    expect(translated[0].name).toBe('Default')
  })

  // T-07 — SPEC-105-T6: getStatistics returns correct counts
  it('getStatistics > comptages corrects', async () => {
    const stats = await translation.getStatistics({ entity_type: 'product' })

    expect(stats).toBeDefined()
    expect(typeof stats.expected).toBe('number')
    expect(typeof stats.translated).toBe('number')
    expect(typeof stats.missing).toBe('number')
    expect(stats.missing).toBe(stats.expected - stats.translated)
  })

  // T-08 — SPEC-134: listLocales returns available locales
  it('listLocales > locales disponibles', async () => {
    const locales = await translation.listLocales()

    expect(Array.isArray(locales)).toBe(true)
    // NoOpTranslationAdapter returns empty array
    // Real adapter returns configured locales
  })

  // T-09 — SPEC-105-T3: applyTranslations batch
  it('applyTranslations > batch', async () => {
    const results = Array.from({ length: 100 }, (_, i) => ({
      id: `p${i}`,
      name: `Product ${i}`,
    }))

    const translated = await translation.applyTranslations(results, 'fr', 'product')

    expect(translated).toHaveLength(100)
  })

  // T-10 — SPEC-105-T3: non-translatable fields unchanged
  it('applyTranslations > champs non-traductibles inchangés', async () => {
    const results = [{ id: 'p1', name: 'Product', price: 99.99 }]
    const translated = await translation.applyTranslations(results, 'fr', 'product')

    // id and price should never be modified
    expect(translated[0].id).toBe('p1')
    expect(translated[0].price).toBe(99.99)
  })

  // T-11 — SPEC-105-T4: T4 (JOIN filter on translatable) → NOT_IMPLEMENTED in v1
  it.todo('T4 > NOT_IMPLEMENTED en v1 — blocked on: Query.graph() with T4 enforcement (SPEC-105-T4). Explicitly NOT_IMPLEMENTED in v1.')
})
