// defineWorkflow — Intra-module workflow definition.
//
// A workflow orchestrates multiple services WITHIN a module.
// It has compensation (like defineCommand) but NO auth context — it's pure business logic.
// It receives typed input via Zod and a scoped step proxy (only module entities).
//
// Called from commands via step.workflow.MODULE.NAME(input).
//
// Usage:
//   // src/modules/customer/workflows/update-customer-with-address.ts
//   export default defineWorkflow({
//     name: 'update-customer-with-address',
//     description: 'Update customer and their default address',
//     input: z.object({
//       id: z.string(),
//       first_name: z.string().optional(),
//       address: z.object({ city: z.string(), country: z.string() }).optional(),
//     }),
//     handler: async (input, { step }) => {
//       if (input.first_name) {
//         await step.service.customer.update(input.id, { first_name: input.first_name })
//       }
//       if (input.address) {
//         await step.service.customerAddress.create({ customer_id: input.id, ...input.address })
//       }
//     },
//   })

import type { z } from 'zod'
import { MantaError } from '../errors/manta-error'
import type { ILoggerPort } from '../ports/logger'

/**
 * Workflow handler context — only step proxy (scoped to module) + logger.
 * NO auth, NO headers — workflows are pure business logic.
 */
export interface WorkflowHandlerContext {
  step: unknown // TypedStep scoped to module — resolved at boot
  log: ILoggerPort
}

/**
 * Workflow definition — returned by defineWorkflow().
 */
export interface ModuleWorkflowDefinition<TInput = unknown, TOutput = unknown> {
  __type: 'workflow'
  name: string
  description: string
  input: z.ZodType<TInput>
  handler: (input: TInput, context: WorkflowHandlerContext) => Promise<TOutput>
  /** Set by bootstrap — restricts step.service to this module's entities */
  __moduleScope?: string
}

/**
 * Define an intra-module workflow — orchestrates multiple entity services within a module.
 *
 * Workflows have compensation (via step proxy) but NO auth context.
 * They are called from commands via `step.workflow.MODULE.NAME(input)`.
 *
 * @example
 * ```typescript
 * // src/modules/customer/workflows/merge-customers.ts
 * export default defineWorkflow({
 *   name: 'merge-customers',
 *   description: 'Merge two customer records into one',
 *   input: z.object({ sourceId: z.string(), targetId: z.string() }),
 *   handler: async (input, { step }) => {
 *     // Move addresses from source to target
 *     const addresses = await step.service.customerAddress.find({ customer_id: input.sourceId })
 *     for (const addr of addresses) {
 *       await step.service.customerAddress.update(addr.id, { customer_id: input.targetId })
 *     }
 *     // Delete source customer
 *     await step.service.customer.delete(input.sourceId)
 *     return { mergedInto: input.targetId }
 *   },
 * })
 * ```
 */
export function defineWorkflow<TInput, TOutput>(config: {
  name: string
  description: string
  input: z.ZodType<TInput>
  handler: (input: TInput, context: WorkflowHandlerContext) => Promise<TOutput>
}): ModuleWorkflowDefinition<TInput, TOutput> {
  if (!config.name) throw new MantaError('INVALID_DATA', 'Workflow name is required')
  if (!config.description) throw new MantaError('INVALID_DATA', `Workflow "${config.name}" requires a description`)
  if (!config.input) throw new MantaError('INVALID_DATA', `Workflow "${config.name}" requires an input Zod schema`)
  if (typeof config.handler !== 'function')
    throw new MantaError('INVALID_DATA', `Workflow "${config.name}" handler must be a function`)

  return {
    __type: 'workflow',
    name: config.name,
    description: config.description,
    input: config.input,
    handler: config.handler,
  }
}
