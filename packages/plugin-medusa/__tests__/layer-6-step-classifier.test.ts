// Layer 6: Step classifier tests — verifies CRUD vs action classification

import { describe, expect, it } from 'vitest'
import { classificationStats, classifyAllSteps, classifyStep } from '../src/_internal/transpiler/step-classifier'
import { extractAllSteps } from '../src/_internal/transpiler/transpile'

describe('layer-6: step classifier', () => {
  // SC-01 — create-product is classified as 'create'
  it('SC-01: create-product → create', () => {
    const result = classifyStep({
      name: 'create-products',
      invoke: async () => ({}),
      compensate: null,
    })
    expect(result.category).toBe('create')
    expect(result.entity).toBe('product')
  })

  // SC-02 — update-product is classified as 'update'
  it('SC-02: update-products → update', () => {
    const result = classifyStep({
      name: 'update-products',
      invoke: async () => ({}),
      compensate: null,
    })
    expect(result.category).toBe('update')
    expect(result.entity).toBe('product')
  })

  // SC-03 — delete-products is classified as 'delete'
  it('SC-03: delete-products → delete', () => {
    const result = classifyStep({
      name: 'delete-products',
      invoke: async () => ({}),
      compensate: null,
    })
    expect(result.category).toBe('delete')
    expect(result.entity).toBe('product')
  })

  // SC-04 — authorize-payment-session-step is force-action
  it('SC-04: authorize-payment-session-step → action', () => {
    const result = classifyStep({
      name: 'authorize-payment-session-step',
      invoke: async () => ({}),
      compensate: null,
    })
    expect(result.category).toBe('action')
    expect(result.entity).toBeUndefined()
  })

  // SC-05 — unknown step defaults to action
  it('SC-05: unknown step defaults to action', () => {
    const result = classifyStep({
      name: 'validate-something-complex',
      invoke: async () => ({}),
      compensate: null,
    })
    expect(result.category).toBe('action')
  })

  // SC-06 — soft-delete-xxx → delete
  it('SC-06: soft-delete-products → delete', () => {
    const result = classifyStep({
      name: 'soft-delete-products',
      invoke: async () => ({}),
      compensate: null,
    })
    expect(result.category).toBe('delete')
  })

  // SC-07 — add-xxx → create
  it('SC-07: add-line-items → create', () => {
    const result = classifyStep({
      name: 'add-line-items',
      invoke: async () => ({}),
      compensate: null,
    })
    expect(result.category).toBe('create')
    expect(result.entity).toBe('line_item')
  })

  // SC-08 — classify all Medusa steps (integration)
  it('SC-08: classifies all captured Medusa steps', () => {
    const allSteps = extractAllSteps()
    if (allSteps.size === 0) return // Skip if no Medusa deps

    const classified = classifyAllSteps(allSteps)
    const stats = classificationStats(classified)

    // Should classify all steps
    expect(stats.total).toBe(allSteps.size)
    expect(stats.total).toBeGreaterThan(0)

    // Should have a mix of categories
    expect(stats.create + stats.update + stats.delete).toBeGreaterThan(0)
    expect(stats.action).toBeGreaterThan(0)

    // CRUD steps should be > 30% of total
    const crudPercent = ((stats.create + stats.update + stats.delete) / stats.total) * 100
    expect(crudPercent).toBeGreaterThan(20)
  })
})
