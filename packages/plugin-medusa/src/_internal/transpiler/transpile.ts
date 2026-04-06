// Transpiler — converts Medusa workflows into Manta-native workflows.
//
// 1. Extract step invoke/compensate from ALL files (steps/ + workflows/) with recursive local imports
// 2. Read DAG order from workflow runtime
// 3. Classify each DAG node: step | query | sub-workflow | hook
// 4. Handle each type appropriately

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

const require = createRequire(import.meta.url)

// ── Types ──────────────────────────────────────

export interface CapturedStep {
  name: string
  invoke: (data: unknown, ctx: { container: { resolve: (key: string) => unknown } }) => Promise<unknown>
  compensate: ((data: unknown, ctx: { container: { resolve: (key: string) => unknown } }) => Promise<void>) | null
}

export type DAGNodeType = 'step' | 'query' | 'sub-workflow' | 'hook'

export interface DAGNode {
  action: string
  noCompensation: boolean
  type: DAGNodeType
}

export interface TranspiledWorkflow {
  name: string
  dag: DAGNode[]
  steps: Map<string, CapturedStep>
  coverage: { matched: number; total: number; queries: number; subWorkflows: number; hooks: number }
}

// ── Node classification ────────────────────────

// Known when() conditions — mapped to if/else in Manta
const WHEN_CONDITIONS = new Set([
  'should-calculate-prices',
  'should-fetch-cart',
  'should-fetch-variants',
  'customer-id-exists',
])

// Known transforms — inline JS data mapping, no step function needed
const KNOWN_TRANSFORMS = new Set([
  'order-change-action-adjustments-input',
  'order-change-action-adjustments-input-remove',
  'order-payment-collection-link',
  'order-payment-collection',
  'calculated-option',
  'option-calculated',
  'flat-reate-option',
  'return-shipping-option',
  'refund-reason',
])

// Steps renamed in the composer — map to real step name
const RENAMED_STEPS: Record<string, string> = {
  'authorize-payment-session': 'authorize-payment-session-step',
  'authorize-payment-session-autocapture': 'authorize-payment-session-step',
  'capture-payment': 'capture-payment-step',
  'capture-payment-autocapture': 'capture-payment-step',
  'delete-sales-channel-links-step': 'dismiss-remote-links',
  'delete-shipping-profile-links-step': 'dismiss-remote-links',
  'remove-variant-link-step': 'dismiss-remote-links',
}

// Renamed queries
const RENAMED_QUERIES = new Set(['query-order-line-items', 'query-order-shipping-methods'])

function classifyNode(action: string): DAGNodeType {
  // Known when() conditions → treated as no-op (logic handled by workflow if/else)
  if (WHEN_CONDITIONS.has(action)) return 'query' // classified as handled

  // Known transforms → inline JS, no step needed
  if (KNOWN_TRANSFORMS.has(action)) return 'query' // classified as handled

  // Renamed queries
  if (RENAMED_QUERIES.has(action)) return 'query'

  // Sub-workflows: called via .runAsStep()
  if (action.endsWith('-as-step')) return 'sub-workflow'

  // Hooks: createHook() — single word or camelCase without hyphens
  if (!action.includes('-') && action.length > 2) return 'hook'

  // Queries: useRemoteQueryStep / useQueryGraphStep renamed
  if (
    action.includes('-query') ||
    action.startsWith('get-') ||
    action.startsWith('fetch-') ||
    action.startsWith('refetch-') ||
    action === 'use-remote-query' ||
    action === 'use-query-graph-step'
  ) {
    return 'query'
  }

  // Everything else is a step — check renamed steps
  return 'step'
}

/**
 * Resolve a step name — handles renamed steps that exist under a different name.
 */
export function resolveStepName(action: string): string {
  return RENAMED_STEPS[action] || action
}

// ── Step extraction ────────────────────────────

export function extractAllSteps(): Map<string, CapturedStep> {
  const dist = dirname(require.resolve('@medusajs/core-flows'))
  const utils = require('@medusajs/utils')
  const captured = new Map<string, CapturedStep>()

  const fakeStepResponse = class {
    __type = 'StepResponse'
    output: unknown
    compensateInput: unknown
    constructor(output: unknown, compensateInput?: unknown) {
      this.output = output
      this.compensateInput = compensateInput
    }
  }

  const fakeWfSdk = {
    createStep: (nameOrConfig: string | { name: string }, invokeFn: Function, compensateFn?: Function) => {
      const name = typeof nameOrConfig === 'string' ? nameOrConfig : nameOrConfig?.name || 'unknown'
      captured.set(name, {
        name,
        invoke: invokeFn as CapturedStep['invoke'],
        compensate: (compensateFn as CapturedStep['compensate']) || null,
      })
      const fn = () => ({})
      Object.assign(fn, { __step__: name, __type: 'step', __captured: true })
      return fn
    },
    StepResponse: fakeStepResponse,
    createWorkflow: () => {
      const fn = () => ({})
      Object.assign(fn, { getName: () => 'stub', runAsStep: () => fn })
      return fn
    },
    transform: (_deps: unknown, fn: Function) => fn({}),
    when: () => ({ then: () => ({}) }),
    createHook: () => ({}),
    WorkflowResponse: class {
      constructor(public result: unknown) {}
    },
    parallelize: (...args: unknown[]) => args,
  }

  function findJsFiles(dir: string): string[] {
    const files: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) files.push(...findJsFiles(full))
      else if (entry.name.endsWith('.js') && !entry.name.endsWith('.map') && !entry.name.endsWith('.d.ts')) {
        files.push(full)
      }
    }
    return files
  }

  const allFiles = findJsFiles(dist)
  const moduleCache = new Map<string, Record<string, unknown>>()

  function loadModule(filePath: string): Record<string, unknown> {
    if (moduleCache.has(filePath)) return moduleCache.get(filePath)!

    const exports: Record<string, unknown> = {}
    moduleCache.set(filePath, exports)

    try {
      const src = readFileSync(filePath, 'utf-8')

      let modified = src
        .replace(/require\("@medusajs\/framework\/workflows-sdk"\)/g, 'FAKE_WF_SDK')
        .replace(/require\("@medusajs\/framework\/utils"\)/g, 'FAKE_UTILS')
        .replace(/require\("@medusajs\/utils"\)/g, 'FAKE_UTILS')
        .replace(/require\("@medusajs\/workflows-sdk"\)/g, 'FAKE_WF_SDK')

      modified = modified.replace(/require\("(\.\.[^"]+|\.\/[^"]+)"\)/g, (_match: string, relPath: string) => {
        const absPath = resolve(dirname(filePath), relPath)
        const resolved = [absPath + '.js', join(absPath, 'index.js'), absPath].find((p) => existsSync(p))
        if (resolved) return `LOCAL_REQUIRE("${resolved}")`
        return '({})'
      })

      modified = modified.replace(/require\("[^"]*"\)/g, '({})')

      const localRequire = (path: string) => loadModule(path)
      const fn = new Function('exports', 'FAKE_WF_SDK', 'FAKE_UTILS', 'LOCAL_REQUIRE', modified)
      fn(exports, fakeWfSdk, utils, localRequire)
    } catch {
      // Module failed to load
    }

    return exports
  }

  for (const file of allFiles) {
    try {
      const src = readFileSync(file, 'utf-8')
      if (!src.includes('createStep')) continue
      loadModule(file)
    } catch {
      // Skip
    }
  }

  return captured
}

// ── DAG extraction ─────────────────────────────

// biome-ignore lint/suspicious/noExplicitAny: Medusa workflow
export function extractDAG(medusaWorkflow: any): DAGNode[] {
  const fakeContainer = { resolve: () => null, cradle: {} }
  const runner = medusaWorkflow(fakeContainer)

  const nodes: DAGNode[] = []
  // biome-ignore lint/suspicious/noExplicitAny: Medusa DAG node
  function walk(node: any) {
    if (!node) return
    if (node.action) {
      nodes.push({
        action: node.action,
        noCompensation: node.noCompensation || false,
        type: classifyNode(node.action),
      })
    }
    if (node.next) walk(node.next)
  }

  walk(runner.flow.steps)
  return nodes
}

// ── Transpiler ─────────────────────────────────

// biome-ignore lint/suspicious/noExplicitAny: Medusa workflow
export function transpileWorkflow(medusaWorkflow: any, allSteps: Map<string, CapturedStep>): TranspiledWorkflow {
  const name = typeof medusaWorkflow.getName === 'function' ? medusaWorkflow.getName() : 'unknown'
  const dag = extractDAG(medusaWorkflow)

  const workflowSteps = new Map<string, CapturedStep>()
  let queries = 0
  let subWorkflows = 0
  let hooks = 0

  for (const node of dag) {
    if (node.type === 'query') {
      queries++
      // Queries are handled by direct service calls in the workflow — no step needed
      continue
    }
    if (node.type === 'sub-workflow') {
      subWorkflows++
      // Sub-workflows are transpiled recursively — the workflow function calls manager.run()
      continue
    }
    if (node.type === 'hook') {
      hooks++
      // Hooks → eventBus.emit in the workflow function
      continue
    }
    // Step — match against captured handlers (try resolved name too)
    const step = allSteps.get(node.action) || allSteps.get(resolveStepName(node.action))
    if (step) workflowSteps.set(node.action, step)
  }

  const totalStepNodes = dag.filter((n) => n.type === 'step').length

  return {
    name,
    dag,
    steps: workflowSteps,
    coverage: {
      matched: workflowSteps.size,
      total: dag.length,
      queries,
      subWorkflows,
      hooks,
    },
  }
}

/**
 * Transpile ALL workflows from @medusajs/core-flows.
 */
export function transpileAllWorkflows(): {
  steps: Map<string, CapturedStep>
  workflows: Map<string, TranspiledWorkflow>
  stats: {
    totalSteps: number
    totalWorkflows: number
    totalDAGNodes: number
    matchedSteps: number
    queries: number
    subWorkflows: number
    hooks: number
    unmatchedSteps: string[]
  }
} {
  const allSteps = extractAllSteps()
  const coreFlows = require('@medusajs/core-flows')

  const workflows = new Map<string, TranspiledWorkflow>()
  let totalDAGNodes = 0
  let totalMatchedSteps = 0
  let totalQueries = 0
  let totalSubWorkflows = 0
  let totalHooks = 0
  const unmatchedSteps = new Set<string>()

  for (const [_, value] of Object.entries(coreFlows)) {
    // biome-ignore lint/suspicious/noExplicitAny: Medusa workflow detection
    const wf = value as any
    if (typeof wf !== 'function' || !wf.getName || !wf.runAsStep) continue

    try {
      const transpiled = transpileWorkflow(wf, allSteps)
      workflows.set(transpiled.name, transpiled)
      totalDAGNodes += transpiled.dag.length
      totalMatchedSteps += transpiled.coverage.matched
      totalQueries += transpiled.coverage.queries
      totalSubWorkflows += transpiled.coverage.subWorkflows
      totalHooks += transpiled.coverage.hooks

      for (const node of transpiled.dag) {
        if (node.type === 'step' && !transpiled.steps.has(node.action)) {
          unmatchedSteps.add(node.action)
        }
      }
    } catch {
      // Skip
    }
  }

  return {
    steps: allSteps,
    workflows,
    stats: {
      totalSteps: allSteps.size,
      totalWorkflows: workflows.size,
      totalDAGNodes,
      matchedSteps: totalMatchedSteps,
      queries: totalQueries,
      subWorkflows: totalSubWorkflows,
      hooks: totalHooks,
      unmatchedSteps: [...unmatchedSteps],
    },
  }
}

export function unwrapStepResponse(result: unknown): unknown {
  // biome-ignore lint/suspicious/noExplicitAny: StepResponse check
  if (result && typeof result === 'object' && (result as any).__type === 'StepResponse') {
    // biome-ignore lint/suspicious/noExplicitAny: StepResponse access
    return (result as any).output
  }
  return result
}
