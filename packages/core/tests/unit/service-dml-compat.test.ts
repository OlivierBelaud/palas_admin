// Verify that createService() accepts DmlEntity objects directly (ISO Medusa)
// Medusa pattern: MedusaService({ Product, Variant })
// Manta pattern: createService({ Product, Variant })

import { createService, field, InMemoryRepository, model } from '@manta/core'
import { describe, expect, it } from 'vitest'

describe('createService() with DmlEntity (ISO Medusa)', () => {
  // Define models using model.define()
  const Post = model.define('Post', {
    title: field.text(),
    views: field.number(),
    status: field.enum(['draft', 'published'] as const).default('draft'),
  })

  const Comment = model.define('Comment', {
    body: field.text(),
    author: field.text(),
  })

  it('accepts DmlEntity objects directly', () => {
    // ISO Medusa: MedusaService({ Post, Comment })
    const ServiceClass = createService({ Post, Comment })
    expect(ServiceClass).toBeDefined()
  })

  it('generates CRUD methods from DmlEntity.name', () => {
    const ServiceClass = createService({ Post, Comment })
    const service = new ServiceClass({ baseRepository: new InMemoryRepository() })

    // Post → retrievePost, listPosts, createPosts, etc.
    expect(typeof service.retrievePost).toBe('function')
    expect(typeof service.listPosts).toBe('function')
    expect(typeof service.createPosts).toBe('function')
    expect(typeof service.updatePosts).toBe('function')
    expect(typeof service.deletePosts).toBe('function')
    expect(typeof service.softDeletePosts).toBe('function')
    expect(typeof service.restorePosts).toBe('function')

    // Comment → retrieveComment, listComments, etc.
    expect(typeof service.retrieveComment).toBe('function')
    expect(typeof service.listComments).toBe('function')
    expect(typeof service.createComments).toBe('function')
  })

  it('CRUD works end-to-end with DmlEntity models', async () => {
    const ServiceClass = createService({ Post })
    // biome-ignore lint/suspicious/noExplicitAny: test
    const service = new ServiceClass({ baseRepository: new InMemoryRepository() }) as any

    // Create
    const post = await service.createPosts({ title: 'Hello', views: 0, status: 'draft' })
    expect(post.title).toBe('Hello')
    expect(post.id).toBeDefined()

    // List
    const posts = await service.listPosts()
    expect(posts).toHaveLength(1)

    // Retrieve
    const found = await service.retrievePost(post.id)
    expect(found.title).toBe('Hello')

    // Update
    const updated = await service.updatePosts({ id: post.id, title: 'Updated' })
    expect(updated.title).toBe('Updated')

    // Delete
    await service.deletePosts([post.id])
    const empty = await service.listPosts()
    expect(empty).toHaveLength(0)
  })

  it('stores $modelObjects on the class (Medusa introspection)', () => {
    const ServiceClass = createService({ Post, Comment })
    // biome-ignore lint/suspicious/noExplicitAny: introspection
    expect((ServiceClass as any).$modelObjects).toBeDefined()
    // biome-ignore lint/suspicious/noExplicitAny: introspection
    expect((ServiceClass as any).$modelObjects.Post).toBe(Post)
  })

  it('has emitEvents_ and aggregatedEvents methods', () => {
    const ServiceClass = createService({ Post })
    const service = new ServiceClass({ baseRepository: new InMemoryRepository() })

    expect(typeof service.emitEvents_).toBe('function')
    expect(typeof service.aggregatedEvents).toBe('function')
  })

  it('constructor accepts cradle proxy (Medusa compat)', () => {
    const repo = new InMemoryRepository()
    // Simulate Awilix cradle — plain object with named services
    const cradle = {
      baseRepository: repo,
      postService: { listPosts: async () => [] },
      eventBusModuleService: { emit: async () => {} },
    }

    const ServiceClass = createService({ Post })
    const service = new ServiceClass(cradle)

    expect(service.baseRepository_).toBe(repo)
    expect(service.eventBusModuleService_).toBeDefined()
    // biome-ignore lint/suspicious/noExplicitAny: test
    expect((service as any).__container__).toBe(cradle)
  })
})
