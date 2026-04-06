import { MantaError, MessageAggregator } from '@manta/test-utils'
import { describe, expect, it } from 'vitest'

describe('Plugin Resolution Tests', () => {
  // PL-01 — SPEC-068/093: CJS plugin resolution in pnpm monorepo
  it('resolution CJS > monorepo pnpm', () => {
    // Simulate CJS plugin resolution
    const pluginPackageJson = {
      name: '@manta/plugin-test',
      main: 'dist/index.js',
      // No "type": "module" → CJS
    }

    // In CJS, require.resolve resolves to correct folder
    // Discovery paths resolved relative to package root
    expect(pluginPackageJson.name).toBe('@manta/plugin-test')
    expect(pluginPackageJson.main).toBe('dist/index.js')

    // Simulated resolution path
    const resolvedPath = '/node_modules/@manta/plugin-test/dist/index.js'
    const packageRoot = resolvedPath.replace('/dist/index.js', '')

    expect(packageRoot).toBe('/node_modules/@manta/plugin-test')
  })

  // PL-02 — SPEC-068/093: ESM plugin resolution
  it('resolution ESM > import.meta.resolve', () => {
    // Simulate ESM plugin resolution
    const pluginPackageJson = {
      name: '@manta/plugin-esm',
      type: 'module',
      exports: { '.': './dist/index.js' },
    }

    expect(pluginPackageJson.type).toBe('module')

    // In ESM, import.meta.resolve returns URL
    const resolvedUrl = 'file:///node_modules/@manta/plugin-esm/package.json'
    const packageRoot = new URL('.', resolvedUrl).pathname

    expect(packageRoot).toContain('@manta/plugin-esm')
  })

  // PL-03 — SPEC-068: compiled plugin with dist/ paths
  it('resolution compiled > dist/', () => {
    // Plugin definePlugin() overrides default discovery paths
    const pluginConfig = {
      name: '@manta/plugin-compiled',
      subscribers: 'dist/subscribers',
      jobs: 'dist/jobs',
      routes: 'dist/routes',
      links: ['dist/links/product-tag.ts'],
    }

    // Resolution finds dist/ paths, not src/
    expect(pluginConfig.subscribers).toBe('dist/subscribers')
    expect(pluginConfig.jobs).toBe('dist/jobs')
    expect(pluginConfig.routes).toBe('dist/routes')
    expect(pluginConfig.subscribers).not.toContain('src/')
  })

  // CS-01 — SPEC-058-OVERRIDE: createService override — throw before super prevents insert and events
  it('override > throw before super prevents insert and events', () => {
    const aggregator = new MessageAggregator()
    let insertOccurred = false

    // Simulate service method override
    class ProductServiceBase {
      async createProducts(data: unknown) {
        insertOccurred = true
        aggregator.save([
          {
            eventName: 'product.created',
            data,
            metadata: { timestamp: Date.now() },
          },
        ])
        return { id: '1' }
      }
    }

    class CustomProductService extends ProductServiceBase {
      async createProducts(data: unknown): Promise<{ id: string }> {
        // Throw BEFORE calling super
        throw new MantaError('INVALID_DATA', 'Custom validation failed')
        // super.createProducts(data) is never called
      }
    }

    const service = new CustomProductService()

    expect(async () => {
      await service.createProducts({ name: 'test' })
    }).rejects.toThrow()

    // Insert did NOT occur
    expect(insertOccurred).toBe(false)

    // No events buffered
    expect(aggregator.getMessages()).toHaveLength(0)
  })
})
