// Verify that createService() generates the exact same methods as Medusa's MedusaService()

import { createService, field, InMemoryRepository, model } from '@manta/core'
import { describe, expect, it } from 'vitest'

describe('createService() method parity with MedusaService', () => {
  const Post = model.define('Post', { title: field.text() })

  it('generates all 12 methods that Medusa generates', () => {
    const ServiceClass = createService({ Post })
    const service = new ServiceClass({ baseRepository: new InMemoryRepository() })

    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(service))
      .filter((m) => m !== 'constructor')
      .sort()

    // These are the exact 12 methods Medusa's MedusaService({ Post }) generates
    const expected = [
      'MedusaContextIndex_',
      'aggregatedEvents',
      'createPosts',
      'deletePosts',
      'emitEvents_',
      'interceptEntityMutationEvents',
      'listAndCountPosts',
      'listPosts',
      'restorePosts',
      'retrievePost',
      'softDeletePosts',
      'updatePosts',
    ]

    for (const method of expected) {
      expect(service[method], `missing method: ${method}`).toBeDefined()
    }

    expect(methods).toEqual(expected)
  })

  it('MedusaContextIndex_ matches Medusa format', () => {
    const ServiceClass = createService({ Post })
    const service = new ServiceClass({ baseRepository: new InMemoryRepository() })

    const idx = service.MedusaContextIndex_ as Record<string, number>
    expect(idx.retrievePost).toBe(2)
    expect(idx.listPosts).toBe(2)
    expect(idx.listAndCountPosts).toBe(2)
    expect(idx.createPosts).toBe(1)
    expect(idx.updatePosts).toBe(1)
    expect(idx.deletePosts).toBe(1)
    expect(idx.softDeletePosts).toBe(2)
    expect(idx.restorePosts).toBe(2)
  })

  it('interceptEntityMutationEvents handles afterCreate', () => {
    const ServiceClass = createService({ Post })
    // biome-ignore lint/suspicious/noExplicitAny: test
    const service = new ServiceClass({ baseRepository: new InMemoryRepository() }) as any

    // Should not throw
    expect(() => {
      service.interceptEntityMutationEvents(
        'afterCreate',
        {
          entity: { id: 'test-1' },
          changeSet: { name: 'post', entity: { id: 'test-1' } },
        },
        {},
      )
    }).not.toThrow()
  })
})
