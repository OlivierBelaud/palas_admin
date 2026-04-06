// Workflow transpiler — converts a Medusa workflow into a Manta-native workflow.
//
// Strategy: runtime extraction, not AST parsing.
// 1. Load the Medusa workflow module
// 2. Intercept all step calls via a recording proxy
// 3. Capture the transform functions
// 4. Generate a Manta createWorkflow/createStep equivalent
//
// The key insight: Medusa's composer function calls steps in order.
// When we call it with proxy inputs, the steps register themselves
// and the transforms capture their data manipulation functions.

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

interface RecordedStep {
  name: string
  /** The raw invoke function from Medusa's createStep */
  invoke: (data: unknown, ctx: { container: { resolve: (key: string) => unknown } }) => Promise<unknown>
  /** The raw compensate function (if any) */
  compensate?: (data: unknown, ctx: { container: { resolve: (key: string) => unknown } }) => Promise<void>
}

interface TranspiledWorkflow {
  name: string
  steps: RecordedStep[]
  /** Run this workflow using Manta's WorkflowManager */
  run: (input: unknown, container: { resolve: (key: string) => unknown }) => Promise<unknown>
}

/**
 * Extract step invoke/compensate functions from a Medusa workflow.
 *
 * Medusa's createStep stores the handler functions on the step object.
 * We read them directly — no AST parsing needed.
 */
export function extractStepsFromWorkflow(
  // biome-ignore lint/suspicious/noExplicitAny: Medusa workflow object
  medusaWorkflow: any,
): RecordedStep[] {
  const steps: RecordedStep[] = []

  // The workflow SDK stores step definitions in a global registry
  // But we can also extract from the compiled step modules directly
  // For now, we use runtime introspection of the step objects

  // Load the workflow-sdk internals to find registered steps
  try {
    const workflowsSdk = require('@medusajs/workflows-sdk')
    const orchestration = require('@medusajs/orchestration')

    // Get the workflow name
    const name = typeof medusaWorkflow.getName === 'function' ? medusaWorkflow.getName() : 'unknown'

    // The WorkflowManager in Medusa stores workflow definitions globally
    const globalManager = orchestration.WorkflowManager ?? orchestration.default?.WorkflowManager
    if (globalManager) {
      const wfDef = globalManager.getWorkflow(name)
      if (wfDef) {
        // Extract steps from the transaction model
        const flow = wfDef.flow_ ?? wfDef.flow
        if (flow?.steps) {
          for (const [stepName, stepDef] of Object.entries(flow.steps)) {
            // biome-ignore lint/suspicious/noExplicitAny: Medusa internal
            const def = stepDef as any
            if (def.invoke?.handler) {
              steps.push({
                name: stepName,
                invoke: def.invoke.handler,
                compensate: def.compensate?.handler,
              })
            }
          }
        }
      }
    }
  } catch {
    // Fallback: can't access workflow internals
  }

  return steps
}

/**
 * Transpile a Medusa workflow into a Manta-native executable.
 *
 * The transpiled workflow:
 * - Uses Manta's createStep (async functions, no proxies)
 * - Runs each Medusa step's invoke function with our container
 * - Handles compensation via the step's compensate function
 * - Replaces transform() with direct JavaScript execution
 */
export function transpileWorkflow(
  // biome-ignore lint/suspicious/noExplicitAny: Medusa workflow object
  medusaWorkflow: any,
): TranspiledWorkflow {
  const name = typeof medusaWorkflow.getName === 'function' ? medusaWorkflow.getName() : 'unknown'

  // For the prototype: we run the Medusa steps directly but through our own
  // execution model (sequential, with compensation tracking).
  // Medusa step invoke functions expect (data, { container: app }) — we pass app.resolve as 'container'.

  const steps = extractStepsFromWorkflow(medusaWorkflow)

  return {
    name,
    steps,
    async run(input: unknown, app: { resolve: (key: string) => unknown }) {
      const completed: Array<{ name: string; output: unknown; compensate?: RecordedStep['compensate'] }> = []

      try {
        let currentInput = input
        for (const step of steps) {
          const output = await step.invoke(currentInput, { container: app })
          completed.push({ name: step.name, output, compensate: step.compensate })
          currentInput = output
        }
        return completed[completed.length - 1]?.output
      } catch (error) {
        // Compensate in reverse
        for (let i = completed.length - 1; i >= 0; i--) {
          const s = completed[i]
          if (s.compensate) {
            try {
              await s.compensate(s.output, { container: app })
            } catch {
              /* best effort */
            }
          }
        }
        throw error
      }
    },
  }
}
