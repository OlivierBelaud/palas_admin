import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  type IWorkflowStoragePort,
  MantaError,
  createTestContainer,
  resetAll,
  InMemoryContainer,
  InMemoryWorkflowStorage,
} from '@manta/test-utils'

describe('IWorkflowStoragePort Conformance', () => {
  let storage: InMemoryWorkflowStorage
  let container: InMemoryContainer

  beforeEach(() => {
    container = createTestContainer()
    storage = container.resolve<InMemoryWorkflowStorage>('IWorkflowStoragePort')
  })

  afterEach(async () => {
    await resetAll(container)
  })

  // WS-01 — SPEC-020: save/load roundtrip
  it('save/load > roundtrip', async () => {
    const data = { result: 'success', count: 42 }

    await storage.save('tx-1', 'step-a', data)
    const loaded = await storage.load('tx-1', 'step-a')

    expect(loaded).toEqual(data)
  })

  // WS-02 — SPEC-020: merge by stepId (load without stepId)
  it('merge > par stepId', async () => {
    await storage.save('tx-1', 'stepA', { resultA: 'a' })
    await storage.save('tx-1', 'stepB', { resultB: 'b' })
    await storage.save('tx-1', 'stepC', { resultC: 'c' })

    const merged = await storage.load('tx-1')

    expect(merged).toBeDefined()
    expect(merged).toMatchObject({
      resultA: 'a',
      resultB: 'b',
      resultC: 'c',
    })
  })

  // WS-03 — SPEC-020: last-write-wins for same stepId
  it('last-write-wins > même stepId', async () => {
    await storage.save('tx-1', 'step-a', { value: 'first' })
    await storage.save('tx-1', 'step-a', { value: 'second' })

    const loaded = await storage.load('tx-1', 'step-a')
    expect(loaded).toEqual({ value: 'second' })
  })

  // WS-04 — SPEC-020: JSON serialization valid
  it('sérialisation > JSON valide', async () => {
    const data = {
      nested: { deep: { value: true } },
      array: [1, 2, 3],
      string: 'hello',
      number: 42.5,
      boolean: false,
      nullable: null,
    }

    await storage.save('tx-1', 'step-a', data)
    const loaded = await storage.load('tx-1', 'step-a')

    expect(loaded).toEqual(data)
  })

  // WS-05 — SPEC-020: schema isolation (workflow vs app)
  it('schema isolation > workflow/app', async () => {
    // In-memory adapter simulates isolation by namespace
    await storage.save('tx-1', 'step-a', { data: 'workflow' })

    // Loading with different transactionId returns null
    const appData = await storage.load('app-tx-1', 'step-a')
    expect(appData).toBeNull()
  })

  // WS-06 — SPEC-020: load nonexistent returns null
  it('load > workflow inexistant', async () => {
    const result = await storage.load('nonexistent')
    expect(result).toBeNull()
  })

  // WS-07 — SPEC-020: cleanup after retention / delete
  it('cleanup > suppression', async () => {
    await storage.save('tx-1', 'step-a', { data: 'test' })

    await storage.delete('tx-1')

    const result = await storage.load('tx-1', 'step-a')
    expect(result).toBeNull()
  })

  // WS-08 — SPEC-020: BigInt serialization roundtrip
  it('sérialisation > BigInt roundtrip', async () => {
    const data = { amount: BigInt(999999999999) }

    await storage.save('tx-1', 'step-a', data as any)
    const loaded = await storage.load('tx-1', 'step-a')

    expect(loaded).toBeDefined()
    // BigInt converted via replacer/reviver
    expect((loaded as any).amount).toBe(BigInt(999999999999))
  })

  // WS-09 — SPEC-020: Map serialization forbidden
  it('sérialisation > Map interdit', async () => {
    const data = { data: new Map([['key', 'value']]) }

    await expect(
      storage.save('tx-1', 'step-a', data as any),
    ).rejects.toThrow()
  })

  // WS-10 — SPEC-020: Date converted to ISO string
  it('sérialisation > Date convertie en string', async () => {
    const date = new Date('2026-01-01T00:00:00.000Z')
    const data = { createdAt: date }

    await storage.save('tx-1', 'step-a', data as any)
    const loaded = await storage.load('tx-1', 'step-a')

    expect(loaded).toBeDefined()
    expect((loaded as any).createdAt).toBe('2026-01-01T00:00:00.000Z')
  })

  // WS-11 — SPEC-020: nested workflows with distinct transactionIds
  it('nested workflows > transactionIds distincts', async () => {
    const dataA = { result: 'workflow-A' }
    const dataB = { result: 'workflow-B' }

    // Same stepId, different transactionIds
    await storage.save('txA', 'step-x', dataA)
    await storage.save('txB', 'step-x', dataB)

    const loadedA = await storage.load('txA', 'step-x')
    const loadedB = await storage.load('txB', 'step-x')

    expect(loadedA).toEqual(dataA)
    expect(loadedB).toEqual(dataB)

    // No collision
    expect(loadedA).not.toEqual(loadedB)
  })
})
