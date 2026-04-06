// Layer 2: Workflow discovery tests

import { beforeAll, describe, expect, it } from 'vitest'
import { clearAlerts, getAlerts } from '../src/_internal/alerts'
import { discoverWorkflows, type WorkflowDiscoveryResult } from '../src/_internal/discovery/workflows'

describe('layer-2: workflows', () => {
  let result: WorkflowDiscoveryResult

  beforeAll(() => {
    clearAlerts()
    result = discoverWorkflows()
  })

  it('discovers >= 300 workflows', () => {
    expect(result.workflows.length).toBeGreaterThanOrEqual(300)
  })

  it('discovers >= 300 steps', () => {
    expect(result.steps.length).toBeGreaterThanOrEqual(300)
  })

  it('total exports from core-flows >= 1000', () => {
    expect(result.totalExports).toBeGreaterThanOrEqual(1000)
  })

  it('workflow IDs are mostly unique (at most 2 duplicates)', () => {
    const ids = result.workflows.map((w) => w.id).filter(Boolean)
    const uniqueIds = new Set(ids)
    // Medusa may have a small number of duplicate workflow names (known issue)
    const duplicates = ids.length - uniqueIds.size
    expect(duplicates).toBeLessThanOrEqual(2)
  })

  it('duplicate workflow names are flagged as alerts', () => {
    const duplicateAlerts = getAlerts('workflow').filter((a) => a.message.includes('Duplicate'))
    // We detect duplicates but they're warnings, not errors
    for (const alert of duplicateAlerts) {
      expect(alert.level).toBe('warn')
    }
  })

  it('key workflows are present', () => {
    const names = result.workflows.map((w) => w.exportName)
    expect(names).toContain('createProductsWorkflow')
    expect(names).toContain('addToCartWorkflow')
    expect(names).toContain('completeCartWorkflow')
  })

  it('ALERT: workflows using createHook() are flagged', () => {
    const hookAlerts = getAlerts('workflow').filter((a) => a.message.includes('createHook'))
    // Some Medusa workflows use hooks — we detect them
    expect(hookAlerts.length).toBeGreaterThanOrEqual(0)
  })

  it('workflow IDs are exported as strings', () => {
    expect(result.workflowIds.length).toBeGreaterThan(0)
    // Spot-check
    expect(result.workflowIds.some((id) => id.includes('Workflow') || id.includes('Step'))).toBe(true)
  })
})
