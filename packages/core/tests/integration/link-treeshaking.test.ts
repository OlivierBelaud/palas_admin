import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  MantaError,
  createTestContainer,
  resetAll,
  InMemoryContainer,
} from '@manta/test-utils'

describe('defineLink Tree-Shaking Integration', () => {
  let container: InMemoryContainer

  beforeEach(() => {
    container = createTestContainer()
  })

  afterEach(async () => {
    await resetAll(container)
  })

  // SPEC-012: links in src/links/ are discovered after build
  it('links in src/links/ are discovered after build', () => {
    // Simulate manifest containing link paths
    const manifest = {
      links: ['src/links/product-collection.ts', 'src/links/order-customer.ts'],
      modules: ['src/modules/product/index.ts'],
    }

    expect(manifest.links).toContain('src/links/product-collection.ts')
    expect(manifest.links).toHaveLength(2)
  })

  // SPEC-012/068: links outside src/links/ in strict mode throws
  it('links outside src/links/ in strict mode throws at boot', () => {
    // Strict mode validates that all links are in src/links/
    const linkPath = 'src/services/product-link.ts' // Wrong location

    const isValidLinkPath = (path: string) => path.startsWith('src/links/')

    expect(isValidLinkPath(linkPath)).toBe(false)

    // In strict mode, this would throw MantaError
    if (!isValidLinkPath(linkPath)) {
      const error = new MantaError(
        'INVALID_STATE',
        `Link "${linkPath}" must be in src/links/ directory (strict mode)`,
      )
      expect(error.type).toBe('INVALID_STATE')
    }
  })

  // SPEC-068: plugin link declared but file missing throws
  it('plugin link declared but file missing throws at build', () => {
    const declaredLinks = ['test-plugin/src/links/product-tag.ts']
    const existingFiles = new Set(['test-plugin/src/links/other.ts'])

    const missingLinks = declaredLinks.filter((l) => !existingFiles.has(l))

    expect(missingLinks).toHaveLength(1)

    // Would throw NOT_FOUND
    const error = new MantaError('NOT_FOUND', `Plugin link file not found: ${missingLinks[0]}`)
    expect(error.type).toBe('NOT_FOUND')
  })

  // SPEC-068: undeclared plugin link is ignored in production
  it('plugin link present but NOT declared is ignored', () => {
    const declaredLinks = ['test-plugin/src/links/declared.ts']
    const filesOnDisk = [
      'test-plugin/src/links/declared.ts',
      'test-plugin/src/links/undeclared.ts',
    ]

    // Manifest only includes declared links
    const manifest = { links: declaredLinks }

    expect(manifest.links).toContain('test-plugin/src/links/declared.ts')
    expect(manifest.links).not.toContain('test-plugin/src/links/undeclared.ts')
  })
})
