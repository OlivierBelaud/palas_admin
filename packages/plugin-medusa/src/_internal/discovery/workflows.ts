// Workflow discovery — imports @medusajs/core-flows and catalogs all workflows and steps.

import { createRequire } from 'node:module'
import { addAlert } from '../alerts'

const require = createRequire(import.meta.url)

export interface DiscoveredWorkflow {
  /** Export name (e.g. 'createProductsWorkflow') */
  exportName: string
  /** Workflow ID/name if available */
  id: string | null
  /** Whether it has hooks */
  hasHooks: boolean
  /** Whether it uses async steps */
  hasAsyncSteps: boolean
}

export interface DiscoveredStep {
  /** Export name (e.g. 'createProductsStep') */
  exportName: string
  /** Step ID if available */
  id: string | null
}

export interface WorkflowDiscoveryResult {
  workflows: DiscoveredWorkflow[]
  steps: DiscoveredStep[]
  workflowIds: string[]
  totalExports: number
}

/**
 * Discover all workflows and steps from @medusajs/core-flows.
 */
export function discoverWorkflows(): WorkflowDiscoveryResult {
  // biome-ignore lint/suspicious/noExplicitAny: dynamic module inspection
  let coreFlows: Record<string, any>
  try {
    coreFlows = require('@medusajs/core-flows')
  } catch (err) {
    addAlert({
      level: 'error',
      layer: 'workflow',
      artifact: '@medusajs/core-flows',
      message: `Could not load @medusajs/core-flows: ${(err as Error).message}`,
    })
    return { workflows: [], steps: [], workflowIds: [], totalExports: 0 }
  }

  const keys = Object.keys(coreFlows)
  const workflows: DiscoveredWorkflow[] = []
  const steps: DiscoveredStep[] = []
  const workflowIds: string[] = []

  for (const key of keys) {
    const val = coreFlows[key]

    // Workflow: has .runAsStep or .getName (Medusa workflow signature)
    if (typeof val === 'function' && (val.runAsStep || val.getName)) {
      const id = typeof val.getName === 'function' ? val.getName() : null
      const hasHooks = !!(val.hooks && Object.keys(val.hooks).length > 0)

      workflows.push({
        exportName: key,
        id,
        hasHooks,
        hasAsyncSteps: false, // Would need deeper inspection
      })

      if (hasHooks) {
        addAlert({
          level: 'info',
          layer: 'workflow',
          artifact: key,
          message: `Workflow uses createHook() — hooks: ${Object.keys(val.hooks).join(', ')}`,
        })
      }
      continue
    }

    // Step: name ends with 'Step' and is a function
    if (typeof val === 'function' && key.endsWith('Step')) {
      const id = typeof val.id === 'string' ? val.id : null
      steps.push({ exportName: key, id })
      continue
    }

    // Workflow ID string: ends with 'WorkflowId' or 'StepId'
    if (typeof val === 'string' && (key.endsWith('WorkflowId') || key.endsWith('StepId'))) {
      workflowIds.push(key)
    }
  }

  // Check for duplicate workflow names
  const workflowNames = workflows.map((w) => w.id).filter(Boolean)
  const seen = new Set<string>()
  for (const name of workflowNames) {
    if (seen.has(name!)) {
      addAlert({
        level: 'warn',
        layer: 'workflow',
        artifact: name!,
        message: 'Duplicate workflow name detected',
      })
    }
    seen.add(name!)
  }

  return {
    workflows,
    steps,
    workflowIds,
    totalExports: keys.length,
  }
}
