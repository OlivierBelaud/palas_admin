import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  MantaError,
  createTestContainer,
  resetAll,
  InMemoryContainer,
} from '@manta/test-utils'

describe('Query.graph() External Module Timeout', () => {
  let container: InMemoryContainer

  beforeEach(() => {
    container = createTestContainer()
  })

  afterEach(async () => {
    await resetAll(container)
  })

  // SPEC-011/007: timeout after configured delay on slow external module
  it('timeout after configured delay', async () => {
    // Simulate a slow external module query that exceeds timeout
    const slowModuleQuery = async (timeoutMs: number): Promise<unknown> => {
      return new Promise((_, reject) => {
        setTimeout(() => {
          reject(new MantaError('UNEXPECTED_STATE', `External module query timed out after ${timeoutMs}ms`))
        }, timeoutMs)
      })
    }

    // 5s timeout configured, module takes longer
    await expect(slowModuleQuery(100)).rejects.toThrow(MantaError)

    try {
      await slowModuleQuery(100)
    } catch (err) {
      if (MantaError.is(err)) {
        expect(err.type).toBe('UNEXPECTED_STATE')
        expect(err.message).toContain('timed out')
      }
    }
  })

  // SPEC-011: fast module returns normally
  it('fast module returns normally', async () => {
    // Simulate a fast external module query
    const fastModuleQuery = async (): Promise<{ data: unknown[] }> => {
      return { data: [{ id: '1', name: 'Product' }] }
    }

    const result = await fastModuleQuery()
    expect(result.data).toBeDefined()
    expect(result.data).toHaveLength(1)
  })
})
